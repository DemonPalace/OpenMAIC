/**
 * Stateless Multi-Agent Generation
 *
 * Single-pass generation with structured JSON Array output format:
 * [{"type":"action","name":"...","params":{...}},{"type":"text","content":"natural speech"},...]
 *
 * Key design decisions:
 * - Backend is stateless (all state in request/response)
 * - Single generation pass (no generate/tool/loop)
 * - Text is natural teacher speech, NOT meta-commentary
 * - Tool calls are silent actions - students see results only
 * - Action and text objects can freely interleave in the array
 * - Uses partial-json for robust streaming of incomplete JSON
 *
 * Multi-agent orchestration:
 * - When multiple agents are configured, a director agent decides who speaks
 * - Uses LangGraph StateGraph for the orchestration loop
 * - Events are streamed via LangGraph's custom stream mode
 */

import type { LanguageModel } from 'ai';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { WhiteboardActionRecord } from './types';
import { createOrchestrationGraph, buildInitialState } from './director-graph';
import { createLogger } from '@/lib/logger';

const log = createLogger('StatelessGenerate');

// ==================== Main Generation Function ====================

/**
 * Stateless generation with streaming via LangGraph orchestration
 *
 * @param request - The chat request with full state
 * @param abortSignal - Signal for cancellation
 * @yields StatelessEvent objects for streaming
 */
export async function* statelessGenerate(
  request: StatelessChatRequest,
  abortSignal: AbortSignal,
  languageModel: LanguageModel,
  thinkingConfig?: ThinkingConfig,
): AsyncGenerator<StatelessEvent> {
  log.info(
    `[StatelessGenerate] Starting orchestration for agents: ${request.config.agentIds.join(', ')}`,
  );
  log.info(
    `[StatelessGenerate] Message count: ${request.messages.length}, turnCount: ${request.directorState?.turnCount ?? 0}`,
  );

  try {
    const graph = createOrchestrationGraph();
    const initialState = buildInitialState(request, languageModel, thinkingConfig);

    const stream = await graph.stream(initialState, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamMode: 'custom' as any,
      signal: abortSignal,
    });

    let totalActions = 0;
    let totalAgents = 0;
    // Tracks whether the agent dispatched in this turn produced any text or actions.
    // Each statelessGenerate call handles exactly one agent turn (client loops externally).
    let agentHadContent = false;

    // Track current agent turn to build updated directorState
    let currentAgentId: string | null = null;
    let currentAgentName: string | null = null;
    let contentPreview = '';
    let agentActionCount = 0;
    const agentWbActions: WhiteboardActionRecord[] = [];

    for await (const chunk of stream) {
      const event = chunk as StatelessEvent;

      if (event.type === 'agent_start') {
        totalAgents++;
        currentAgentId = event.data.agentId;
        currentAgentName = event.data.agentName;
        contentPreview = '';
        agentActionCount = 0;
        agentWbActions.length = 0;
      }
      if (event.type === 'text_delta' && contentPreview.length < 100) {
        contentPreview = (contentPreview + event.data.content).slice(0, 100);
        agentHadContent = true;
      }
      if (event.type === 'action') {
        totalActions++;
        agentActionCount++;
        agentHadContent = true;
        if (event.data.actionName.startsWith('wb_')) {
          agentWbActions.push({
            actionName: event.data.actionName as WhiteboardActionRecord['actionName'],
            agentId: event.data.agentId,
            agentName: currentAgentName || event.data.agentId,
            params: event.data.params,
          });
        }
      }

      yield event;
    }

    // Build updated directorState from incoming state + this turn's data
    const incoming = request.directorState;
    const prevResponses = incoming?.agentResponses ?? [];
    const prevLedger = incoming?.whiteboardLedger ?? [];
    const prevTurnCount = incoming?.turnCount ?? 0;

    const directorState =
      totalAgents > 0
        ? {
            turnCount: prevTurnCount + 1,
            agentResponses: [
              ...prevResponses,
              {
                agentId: currentAgentId!,
                agentName: currentAgentName || currentAgentId!,
                contentPreview,
                actionCount: agentActionCount,
                whiteboardActions: [...agentWbActions],
              },
            ],
            whiteboardLedger: [...prevLedger, ...agentWbActions],
          }
        : {
            turnCount: prevTurnCount,
            agentResponses: prevResponses,
            whiteboardLedger: prevLedger,
          };

    yield {
      type: 'done',
      data: { totalActions, totalAgents, agentHadContent, directorState },
    };

    log.info(
      `[StatelessGenerate] Completed. Agents: ${totalAgents}, Actions: ${totalActions}, hadContent: ${agentHadContent}, turnCount: ${directorState.turnCount}`,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      yield { type: 'error', data: { message: 'Request interrupted' } };
    } else {
      log.error('[StatelessGenerate] Error:', error);
      yield {
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
