import 'server-only';
import type { PersistedAgentSessionEvent } from '@openmaic/storage';
import type { AgentRole } from '@/lib/pbl/v3/domain/project/project-schema';
import type { LearningConversationEntry } from '@/lib/pbl/v3/conversation';
import { reviewQuestion } from './review-question';

type Part = LearningConversationEntry['parts'][number];
const visibleTools = {
  read_file: 'read',
  write_file: 'write',
  run_build: 'build',
  collect_build: 'collect',
  request_skill_review: 'review',
  complete_stage: 'complete',
} as const;

/** Adapt existing durable Pi events. Text snapshots replace deltas; tool output never crosses this boundary. */
export function projectConversation(
  events: PersistedAgentSessionEvent[],
  role: AgentRole,
  running: boolean,
): LearningConversationEntry[] {
  const entries: LearningConversationEntry[] = [];
  let assistant: LearningConversationEntry | undefined;
  let message: Extract<Part, { kind: 'text' }> | undefined;
  let attempt: number | undefined;
  const tools = new Map<string, Extract<Part, { kind: 'tool' }>>();
  const settle = () => {
    for (const tool of tools.values()) if (tool.status === 'running') tool.status = 'interrupted';
    if (message) message.streaming = false;
    tools.clear();
    message = undefined;
  };
  for (const event of events) {
    if (attempt !== undefined && event.attempt !== attempt) {
      settle();
      assistant = undefined;
    }
    attempt = event.attempt;
    const data = event.data as {
      text?: string;
      toolName?: string;
      toolCallId?: string;
      isError?: boolean;
      message?: { role?: string; content?: { type?: string; text?: string }[] };
    };
    if (event.type === 'pbl_stage_entered') {
      settle();
      assistant = undefined;
      entries.push({
        id: `stage-${event.id}`,
        at: event.ts,
        speaker: role,
        parts: [],
        boundary: event.data as LearningConversationEntry['boundary'],
      });
      continue;
    }
    if (event.type === 'user_message' && (event.data as { pblOpening?: boolean }).pblOpening) {
      settle();
      assistant = undefined;
      continue;
    }
    if (event.type === 'user_message' && typeof data.text === 'string') {
      settle();
      assistant = undefined;
      entries.push({
        id: `user-${event.id}`,
        at: event.ts,
        speaker: 'user',
        parts: [{ kind: 'text', id: `${event.id}`, text: data.text }],
      });
      continue;
    }
    const getAssistant = () => {
      if (!assistant) {
        assistant = { id: `turn-${event.id}`, at: event.ts, speaker: role, parts: [] };
        entries.push(assistant);
      }
      return assistant;
    };
    if (
      ['message_start', 'message_update', 'message_end'].includes(event.type) &&
      data.message?.role === 'assistant'
    ) {
      if (event.type === 'message_start') message = undefined;
      const text = (data.message.content ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n');
      if (text) {
        if (!message) {
          message = { kind: 'text', id: `text-${event.id}`, text };
          getAssistant().parts.push(message);
        }
        message.text = text;
        message.streaming = running && event.type !== 'message_end';
      }
      if (event.type === 'message_end') {
        if (message) message.streaming = false;
        message = undefined;
      }
    }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      const action = visibleTools[data.toolName as keyof typeof visibleTools];
      if (action && data.toolCallId) {
        let tool = tools.get(data.toolCallId);
        if (!tool) {
          tool = {
            kind: 'tool',
            id: `tool-${event.attempt}-${data.toolCallId}`,
            action,
            status: 'running',
          };
          tools.set(data.toolCallId, tool);
          getAssistant().parts.push(tool);
        }
        tool.status =
          event.type === 'tool_execution_start' ? 'running' : data.isError ? 'failed' : 'succeeded';
      }
      const question = reviewQuestion(event);
      if (question)
        getAssistant().parts.push({ kind: 'text', id: `question-${event.id}`, text: question });
    }
  }
  if (!running) settle();
  return entries.filter((e) => e.boundary || e.parts.length).slice(-60);
}
