import 'server-only';
import { createHash } from 'node:crypto';
import type { SandboxService } from '@/lib/server/sandbox/service';
import type { SandboxEnvironment } from '@/lib/sandbox/types';
import { sandboxConflict } from '@/lib/sandbox/errors';
import type { Study, LearningStore } from './store';
import type { InstalledProject } from './catalog';

/** Renew active studies at most once every 20 seconds (the provider supports a 60-second minimum TTL), including while the learner reads or edits. */
export async function touchEnvironment(store: LearningStore, row: Study, service: SandboxService) {
  if (!row.environment_id) return null;
  let env = await service.get(row.environment_id);
  if (!row.environment_checked_at || Date.now() - row.environment_checked_at.getTime() >= 20_000) {
    env = await service.reconcile(env.id);
    if (env.state === 'running' && env.workspaceReady) {
      await service.renew(env.id);
      await store.pool.query(
        'UPDATE pbl_v3_studies SET environment_checked_at=now() WHERE id=$1 AND environment_id=$2',
        [row.id, env.id],
      );
    }
  }
  return env;
}
export function assertEnvironmentReady(env: SandboxEnvironment | null) {
  if (!env || env.state !== 'running' || !env.workspaceReady)
    throw sandboxConflict('Prepare or recover the project environment before continuing.');
}

/** Revalidate only the active milestone; this PR installs a single-milestone project. */
export function recoveredProgress(
  row: Study,
  project: InstalledProject,
  files: Record<string, string>,
) {
  const state = structuredClone(row.state);
  const milestone = project.definition.milestones[state.position.milestoneIndex];
  const collected = milestone && state.collected[milestone.id];
  if (!collected || !state.introCompleted) return { state, reset: false };
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const fingerprint = hash(
    JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  );
  const planChanged =
    !!collected.plan && collected.plan.contentHash !== hash(files['PLAN.md'] ?? '');
  if (collected.plan && !planChanged) collected.plan.workspaceRevisionId = fingerprint;
  const codeChanged =
    planChanged || (!!collected.code && collected.code.workspaceRevisionId !== fingerprint);
  const testsChanged =
    codeChanged || (!!collected.tests && collected.tests.revision.id !== fingerprint);
  let restart = -1;
  if (planChanged) {
    collected.plan = null;
    collected.planReviewCompleted = false;
    restart = milestone.stages.findIndex((s) => s.kind === 'produce' && s.writes === 'plan');
  }
  if (codeChanged) {
    collected.code = null;
    collected.codeReviewCompleted = false;
    if (restart < 0)
      restart = milestone.stages.findIndex((s) => s.kind === 'produce' && s.writes === 'code');
  }
  if (testsChanged || row.evaluation) {
    collected.tests = null;
    collected.remediation = null;
    collected.quiz = null;
    collected.recapCompleted = false;
    if (restart < 0)
      restart = milestone.stages.findIndex((s) => s.kind === 'check' && s.checker === 'tests');
  }
  if (restart < 0) return { state, reset: false };
  // Never skip unfinished teaching on the way back to the first invalidated artifact.
  restart = Math.min(restart, state.position.stageIndex);
  state.status = 'waiting_for_student';
  state.position = {
    ...state.position,
    stageIndex: restart,
    activeAgent: undefined,
    activeAgentId: undefined,
  };
  const progress = state.milestones[state.position.milestoneIndex]!;
  progress.status = 'active';
  progress.stageIndex = restart;
  progress.completedStageIndexes = progress.completedStageIndexes.filter((i) => i < restart);
  progress.evaluationIds = [];
  return { state, reset: true };
}
