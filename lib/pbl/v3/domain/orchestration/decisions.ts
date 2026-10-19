export interface DecisionRecord<TChosen = string> {
  id: string;
  chosen: TChosen;
  revision: number;
}

export interface DecisionProgress<TChosen = string> {
  decisions: readonly DecisionRecord<TChosen>[];
}

export function recordDecision<TChosen>(
  progress: DecisionProgress<TChosen>,
  decisionId: string,
  chosen: TChosen,
): DecisionProgress<TChosen> {
  const existingIndex = progress.decisions.findIndex((decision) => decision.id === decisionId);
  if (existingIndex < 0) {
    return {
      ...progress,
      decisions: [...progress.decisions, { id: decisionId, chosen, revision: 0 }],
    };
  }

  return {
    ...progress,
    decisions: progress.decisions.map((decision, index) =>
      index === existingIndex ? { ...decision, chosen, revision: decision.revision + 1 } : decision,
    ),
  };
}
