import type { LearningView } from './types';

/** Labels follow authoritative progress; they never authorize a transition. */
export function learningStep(view: Pick<LearningView, 'state' | 'stage'>): string {
  if (!view.state.introCompleted) return 'intro';
  const stage = view.stage;
  if (stage.kind === 'produce') return stage.exploration ? 'explore' : stage.writes;
  if (stage.kind === 'check') return stage.checker;
  if (stage.kind === 'mentor_say') return stage.agent === 'discussion' ? 'teaching' : 'recap';
  return stage.kind;
}
