import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  reportAnalysisInput,
  reportSources,
  validateReportFindings,
} from '@/lib/server/pbl-v3/report-analysis';
import { reportConversationMessages, type LearningReport } from '@/lib/pbl/v3/report';

const report: LearningReport = {
  studyId: 'study',
  project: { id: 'project', version: '1', title: 'Project' },
  revision: 1,
  requiredComplete: true,
  milestones: [],
  outcomes: [],
  counts: {},
  truncated: false,
  evidence: [{ sequence: 1, at: 1, kind: 'evaluation.recorded', detail: 'passed' }],
  conversations: [
    {
      role: 'coder',
      milestone: 'one',
      truncated: false,
      messages: [
        {
          sequence: 2,
          at: 2,
          role: 'user',
          text: 'I changed the loop to preserve the earlier greeting.',
        },
        {
          sequence: 3,
          at: 3,
          role: 'assistant',
          text: 'The implementation preserves the greeting.',
        },
      ],
    },
  ],
};
const finding = {
  category: 'change',
  title: 'Preserving earlier behavior',
  detail: 'The learner explained their correction.',
  evidence: ['turn:0:2'],
  quote: 'changed the loop',
};

describe('grounded report analysis', () => {
  it('shares chronological conversation order with the UI and interleaves analysis sources without changing citations', () => {
    const mixed: LearningReport = {
      ...report,
      evidence: [
        { sequence: 7, at: 7, kind: 'evaluation.recorded', detail: 'passed' },
        { sequence: -4, at: 4, kind: 'file-edit', detail: 'The correction' },
      ],
      conversations: [
        {
          role: 'mentor',
          milestone: 'project',
          truncated: false,
          messages: [
            { sequence: 1, at: 1, role: 'assistant', text: 'Welcome' },
            { sequence: 2, at: 8, role: 'assistant', text: 'Final reflection' },
          ],
        },
        {
          role: 'coder',
          milestone: 'two',
          truncated: false,
          messages: [
            { sequence: 1, at: 5, role: 'user', text: 'I changed the loop' },
            { sequence: 2, at: 6, role: 'assistant', text: 'Review the correction' },
          ],
        },
        {
          role: 'planner',
          milestone: 'one',
          truncated: false,
          messages: [
            { sequence: 1, at: 2, role: 'user', text: 'My plan' },
            { sequence: 2, at: 3, role: 'assistant', text: 'Review the plan' },
          ],
        },
      ],
    };
    const before = structuredClone(mixed);
    expect(reportConversationMessages(mixed).map((m) => m.id)).toEqual([
      'turn:0:1',
      'turn:2:1',
      'turn:2:2',
      'turn:1:1',
      'turn:1:2',
      'turn:0:2',
    ]);
    const input = reportAnalysisInput(mixed);
    expect(input.records.map((r) => r.at)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reportSources(mixed).map((r) => r.id)).toContain('event:-4');
    expect(
      validateReportFindings(
        JSON.stringify({ findings: [{ ...finding, evidence: ['turn:1:1'] }] }),
        mixed,
      ),
    ).toHaveLength(1);
    expect(mixed).toEqual(before);
  });
  it('accepts a finding with a real learner quote and rejects invented references or quotes', () => {
    expect(validateReportFindings(JSON.stringify({ findings: [finding] }), report)).toEqual([
      finding,
    ]);
    for (const invalid of [
      { ...finding, evidence: ['turn:0:999'] },
      { ...finding, quote: 'I completely mastered programming' },
      { ...finding, evidence: ['turn:0:3'], quote: 'preserves the greeting' },
      { ...finding, quote: undefined },
    ])
      expect(() => validateReportFindings(JSON.stringify({ findings: [invalid] }), report)).toThrow(
        'No supported',
      );
  });
  it('bounds analysis across the journey while retaining full stored records and reporting omissions', () => {
    const large = {
      ...report,
      evidence: Array.from({ length: 2000 }, (_, i) => ({
        sequence: i,
        at: i,
        kind: 'artifact',
        detail: `record ${i} ` + 'x'.repeat(1000),
      })),
    };
    const input = reportAnalysisInput(large);
    expect(input.records).toHaveLength(1000);
    expect(input.records[0]?.id).toBe('event:0');
    expect(input.records.at(-1)?.id).toBe('event:1999');
    expect(input.omitted).toBe(true);
    expect(large.evidence[0]?.detail.length).toBeGreaterThan(1000);
    expect(input.records.reduce((n, r) => n + r.text.length, 0)).toBeLessThanOrEqual(60_000);
  });
});
