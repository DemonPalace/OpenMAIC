import type { ArtifactRef } from '../project/project-schema';
import type { DecisionRecord } from './decisions';

export interface DecisionQuestion {
  id: string;
  desc?: string;
  decisionPrompt?: string;
  options?: readonly unknown[];
}

export interface ArtifactMilestone {
  contract?: string;
  decisions?: readonly string[];
}

export interface ArtifactState {
  decisions?: readonly DecisionRecord[];
  plan?: string;
  code?: string;
}

export interface ArtifactProjectionInput {
  reads: readonly ArtifactRef[];
  milestone: ArtifactMilestone;
  state: ArtifactState;
  decisionCatalog: readonly DecisionQuestion[];
}

export interface ArtifactProjection {
  contract?: string;
  decisions?: readonly {
    id: string;
    desc?: string;
    prompt?: string;
    options?: readonly unknown[];
  }[];
  decisionsChosen?: readonly Pick<DecisionRecord, 'id' | 'chosen'>[];
  plan?: string;
  code?: string;
}

export function projectArtifacts({
  reads,
  milestone,
  state,
  decisionCatalog,
}: ArtifactProjectionInput): ArtifactProjection {
  const projection: ArtifactProjection = {};

  for (const artifact of reads) {
    if (artifact === 'contract') projection.contract = milestone.contract ?? '';
    if (artifact === 'decisions') {
      projection.decisions = (milestone.decisions ?? []).map((decisionId) => {
        const definition = decisionCatalog.find((decision) => decision.id === decisionId);
        if (!definition) return { id: decisionId };
        return {
          id: definition.id,
          ...(definition.desc === undefined ? {} : { desc: definition.desc }),
          ...(definition.decisionPrompt === undefined ? {} : { prompt: definition.decisionPrompt }),
          ...(definition.options === undefined ? {} : { options: definition.options }),
        };
      });
    }
    if (artifact === 'decisions.chosen') {
      projection.decisionsChosen = (state.decisions ?? []).map(({ id, chosen }) => ({
        id,
        chosen,
      }));
    }
    if (artifact === 'plan') projection.plan = state.plan ?? '';
    if (artifact === 'code') projection.code = state.code ?? '';
  }

  return projection;
}
