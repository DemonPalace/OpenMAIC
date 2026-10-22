import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { reportAnalysisInput, validateReportFindings } from '@/lib/server/pbl-v3/report-analysis';
import type { LearningReport } from '@/lib/pbl/v3/report';

const report: LearningReport = {
  studyId: 'study',
  project: { id: 'project', version: '1', title: 'Project' },
  revision: 1,
  requiredComplete: true,
  milestones: [],
  outcomes: [],
  counts: {},
  truncated: false,
  evidence: [{ sequence: 1, kind: 'evaluation.recorded', detail: 'passed' }],
  conversations: [
    {
      role: 'coder',
      milestone: 'one',
      truncated: false,
      messages: [
        { sequence: 2, role: 'user', text: 'I changed the loop to preserve the earlier greeting.' },
        { sequence: 3, role: 'assistant', text: 'The implementation preserves the greeting.' },
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
        kind: 'artifact',
        detail: `record ${i} ` + 'x'.repeat(1000),
      })),
    };
    const input = reportAnalysisInput(large);
    expect(input.records).toHaveLength(1000);
    expect(input.records[0]?.id).toBe('event:0');
    expect(input.records.at(-1)?.id).toBe('turn:0:3');
    expect(input.omitted).toBe(true);
    expect(large.evidence[0]?.detail.length).toBeGreaterThan(1000);
    expect(input.records.reduce((n, r) => n + r.text.length, 0)).toBeLessThanOrEqual(60_000);
  });
});
