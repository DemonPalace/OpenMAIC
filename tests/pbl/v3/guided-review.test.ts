import { describe, expect, it } from 'vitest';
import { GuidedSkillReview } from '@/lib/server/pbl-v3/guided-review';
import { isPBLV3Reference } from '@/lib/pbl/v3/types';

const protocol = {
  digest: 'protocol-v1',
  progression: ['SKILL.md', 'A-teach.md', 'B-review.md'],
  final: 'B-review.md',
};
const artifact = 'a'.repeat(64);

describe('guided review boundaries', () => {
  it('requires a later real reply and refuses changed artifacts or fabricated quotes', () => {
    const review = new GuidedSkillReview(protocol);
    review.beginRun('turn-1', 'Start', false);
    review.advance('A-teach.md', undefined, artifact);
    const receipt = review.checkpoint('Explain the return value.', artifact);
    const restored = new GuidedSkillReview(protocol, receipt);
    restored.beginRun('turn-1', 'Start', true);
    expect(() => restored.assertWritable()).toThrow();
    expect(() => restored.checkpoint('Ask again', artifact)).toThrow();
    expect(() => restored.advance('B-review.md', 'Start', artifact)).toThrow();
    restored.beginRun('turn-2', 'It returns the greeting.', true);
    expect(() => restored.assertWritable()).not.toThrow();
    expect(() => restored.advance('B-review.md', 'I approve', artifact)).toThrow();
    expect(() => restored.advance('B-review.md', 'returns the greeting', 'b'.repeat(64))).toThrow();
    restored.advance('B-review.md', 'returns the greeting', artifact);
    expect(() => restored.complete('returns the greeting', artifact)).toThrow();
    restored.checkpoint('Confirm the example.', artifact);
    restored.beginRun('turn-3', 'The example is correct.', true);
    expect(() => restored.complete('example is correct', artifact)).not.toThrow();
  });

  it('cannot skip sections or reuse receipts after a protocol change', () => {
    const review = new GuidedSkillReview(protocol);
    review.beginRun('turn-1', 'Start', false);
    expect(() => review.advance('B-review.md', undefined, artifact)).toThrow();
    review.advance('A-teach.md', undefined, artifact);
    const receipt = review.checkpoint('Explain.', artifact);
    const changed = new GuidedSkillReview({ ...protocol, digest: 'protocol-v2' }, receipt);
    expect(changed.state.activeFile).toBe('');
    expect(changed.state.pending).toBeUndefined();
  });

  it('accepts only bounded installed-project references', () => {
    expect(isPBLV3Reference({ id: 'greeting-python', version: '1.0.0' })).toBe(true);
    for (const value of [
      null,
      [],
      { id: '../project', version: '1' },
      { id: 'project', version: 1 },
      { id: 'p'.repeat(81), version: '1' },
    ])
      expect(isPBLV3Reference(value)).toBe(false);
  });
});
