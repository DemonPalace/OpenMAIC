import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { projectConversation } from '@/lib/server/pbl-v3/conversation';
import { stageSkill, interactionRules } from '@/lib/server/pbl-v3/skills';
import type { PersistedAgentSessionEvent } from '@openmaic/storage';
import type { StageDefinition } from '@/lib/pbl/v3/domain/project/project-schema';

const event = (
  id: number,
  type: string,
  data: unknown,
  attempt = 1,
): PersistedAgentSessionEvent => ({ id, type, data, attempt, ts: id });
const message = (text: string) => ({
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'thinking', thinking: 'PRIVATE REASONING' },
    ],
  },
});
describe('student conversation projection', () => {
  it('updates a single text block and preserves tool order without revealing payloads', () => {
    const history = [
      event(1, 'user_message', { text: 'Please explain' }),
      event(2, 'message_start', message('')),
      event(3, 'message_update', message('Hel')),
      event(4, 'message_update', message('Hello')),
      event(5, 'message_end', message('Hello')),
      event(6, 'tool_execution_start', {
        toolName: 'write_file',
        toolCallId: 'w',
        args: { text: 'SECRET SOURCE' },
      }),
      event(7, 'tool_execution_end', {
        toolName: 'write_file',
        toolCallId: 'w',
        result: { content: [{ type: 'text', text: 'PRIVATE OUTPUT' }] },
      }),
      event(8, 'tool_execution_start', { toolName: 'read_next_skill', toolCallId: 's' }),
      event(9, 'tool_execution_end', {
        toolName: 'read_next_skill',
        toolCallId: 's',
        result: { content: [{ type: 'text', text: 'SECRET PROTOCOL' }] },
      }),
      event(10, 'message_start', message('Done')),
      event(11, 'message_update', message('Done, now review')),
    ];
    const output = projectConversation(history, 'coder', true);
    expect(output).toHaveLength(2);
    expect(output[1]!.parts.map((p) => p.kind)).toEqual(['text', 'tool', 'text']);
    expect(output[1]!.parts[0]).toMatchObject({ text: 'Hello', streaming: false });
    expect(output[1]!.parts[2]).toMatchObject({ text: 'Done, now review', streaming: true });
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE|SECRET|thinking|read_next_skill/);
  });
  it('settles interrupted tools and retains saved review questions on a failed turn', () => {
    const history = [
      event(1, 'tool_execution_start', { toolName: 'run_build', toolCallId: 'b' }),
      event(2, 'tool_execution_end', {
        toolName: 'request_skill_review',
        toolCallId: 'q',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ question: 'Why this choice?', waitForStudent: true }),
            },
          ],
        },
      }),
    ];
    const output = projectConversation(history, 'planner', false);
    expect(output[0]!.parts[0]).toMatchObject({ status: 'interrupted' });
    expect(output[0]!.parts.at(-1)).toMatchObject({ text: 'Why this choice?' });
  });
  it('does not conflate retry attempts or publish failed tool diagnostics', () => {
    const output = projectConversation(
      [
        event(1, 'tool_execution_start', { toolName: 'read_file', toolCallId: 'x' }),
        event(
          2,
          'tool_execution_end',
          {
            toolName: 'read_file',
            toolCallId: 'x',
            isError: true,
            result: { error: 'secret provider URL' },
          },
          2,
        ),
      ],
      'coder',
      false,
    );
    expect(output).toHaveLength(2);
    expect(output[0]!.parts[0]).toMatchObject({ status: 'interrupted' });
    expect(output[1]!.parts[0]).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(output)).not.toContain('provider');
  });
});
describe('general teaching protocols', () => {
  it('does not mistake a named pre-decision skill for mentor reflection', () => {
    const skill = stageSkill({
      kind: 'mentor_say',
      agent: 'discussion',
      skill: 'discussion-pre-decision',
    } as StageDefinition);
    expect(skill.content['A-teach.md']).toContain('projectContext');
    expect(JSON.stringify(skill)).not.toMatch(/Future Self|Spring Boot|Java|M[0-9]/);
    const recap = stageSkill({
      kind: 'mentor_say',
      agent: 'mentor',
      skill: 'recap',
    } as StageDefinition);
    expect(recap.content['A-teach.md']).toContain('observed tests');
  });
  it('retains progressive review and current-host tool contracts', () => {
    const plan = stageSkill({ kind: 'produce', writes: 'plan' } as StageDefinition);
    expect(plan.progression).toEqual([
      'SKILL.md',
      'A-generate.md',
      'B-understand.md',
      'C-review.md',
      'D-approve.md',
    ]);
    expect(JSON.stringify(plan.content)).toContain('write_file');
    expect(JSON.stringify(plan.content)).not.toContain('`write`');
    expect(interactionRules).toContain('先在当前边界内正面解释');
    expect(interactionRules).toContain('真实新回复');
  });
});
