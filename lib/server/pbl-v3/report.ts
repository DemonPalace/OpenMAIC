import 'server-only';
import { randomUUID } from 'node:crypto';
import { sandboxConflict } from '@/lib/sandbox/errors';
import { analyzeLearningReport } from './report-analysis';
import type { OwnerPrincipal } from '@/lib/server/identity/types';
import type { OrchestrationEvent } from '@/lib/pbl/v3/domain/orchestration/events';
import type { LearningReport } from '@/lib/pbl/v3/report';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import { LearningStore } from './store';
import { projectFor } from './runtime';
import { reviewQuestion } from './review-question';

/** Facts come from durable events. This read does not require an execution environment or change progress. */
export async function learningEvidence(
  principal: OwnerPrincipal,
  id: string,
): Promise<LearningReport> {
  const store = await LearningStore.open(),
    row = await store.get(id, principal.ownerId);
  const project = projectFor(row);
  const evidence: LearningReport['evidence'] = [];
  const records = await store.pool.query<{ sequence: number; event: OrchestrationEvent }>(
    'SELECT sequence,event FROM pbl_v3_events WHERE study_id=$1 AND sequence<=$2 ORDER BY sequence',
    [id, row.state.lastSequence],
  );
  const versions = new Map<string, string>();
  const versionLabel = (hash: string) => {
    if (!versions.has(hash)) versions.set(hash, `v${versions.size + 1}`);
    return versions.get(hash)!;
  };
  for (const { sequence, event } of records.rows) {
    let detail: string | undefined, version: string | undefined;
    let milestoneId = 'milestoneId' in event ? event.milestoneId : undefined;
    switch (event.type) {
      case 'decision.recorded': {
        const d = project.definition.decisions.find((d) => d.id === event.decisionId);
        detail = `${d?.decisionPrompt ?? event.decisionId}: ${d?.options.find((o) => o.id === event.chosen)?.label ?? event.chosen ?? ''}`;
        break;
      }
      case 'artifact.recorded':
        milestoneId = event.artifact.milestoneId;
        detail =
          event.artifact.kind === 'plan'
            ? (event.content ?? '')
            : (event.changedPaths?.join('\n') ?? event.artifact.value);
        version = event.artifact.workspaceRevisionId
          ? versionLabel(event.artifact.workspaceRevisionId)
          : undefined;
        break;
      case 'evaluation.recorded':
        milestoneId = event.evaluation.milestoneId;
        detail = `${event.evaluation.status}\n${event.evaluation.publicFeedback ?? ''}`;
        version = versionLabel(event.evaluation.revision.id);
        break;
      case 'quiz.recorded':
        detail = `${event.quiz.score}/${event.quiz.total} · attempt ${event.quiz.attempt}`;
        break;
      case 'milestone.completed':
        detail =
          project.definition.milestones.find((m) => m.id === event.milestoneId)?.title ??
          event.milestoneId;
        break;
      case 'recap.completed':
      case 'teaching.completed':
      case 'artifact.review.completed':
        detail = event.type;
        break;
    }
    if (detail !== undefined)
      evidence.push({
        sequence,
        milestoneId,
        kind: event.type,
        detail,
        ...(detail.length >= 12000 &&
        event.type === 'artifact.recorded' &&
        event.content?.endsWith('…（后略）')
          ? { truncated: true }
          : {}),
        ...(version ? { version } : {}),
      });
  }
  const counts = Object.fromEntries(
    (
      await store.pool.query<{ kind: string; count: number }>(
        "SELECT event->>'type' AS kind,count(*)::int AS count FROM pbl_v3_events WHERE study_id=$1 AND sequence<=$2 GROUP BY event->>'type'",
        [id, row.state.lastSequence],
      )
    ).rows.map((r) => [r.kind, r.count]),
  );
  const agents = await getAgentSessionStore();
  const conversations: LearningReport['conversations'] = [];
  let interruptedRuns = 0;
  let missingConversation = false;
  for (const binding of await store.roles(id)) {
    if (!(await agents.getSession(binding.session_id))) {
      missingConversation = true;
      continue;
    }
    const last = await agents.lastEventSeq(binding.session_id);
    const entries = [];
    let cursor = 0;
    while (cursor < last) {
      const page = (await agents.readEventsAfter(binding.session_id, cursor, 500)).filter(
        (e) => e.id <= last,
      );
      if (!page.length) break;
      entries.push(...page);
      cursor = page.at(-1)!.id;
    }
    const messages: LearningReport['conversations'][number]['messages'] = [];
    let latestInputSequence: number | undefined;
    for (const entry of entries) {
      if (
        entry.type === 'session_interrupted' ||
        (entry.type === 'session_end' && (entry.data as { status?: string }).status === 'failed')
      )
        interruptedRuns++;
      const data = entry.data as {
        text?: string;
        pblOpening?: boolean;
        message?: { role?: string; content?: { type: string; text?: string }[] };
      };
      const question = reviewQuestion(entry);
      if (question !== null)
        messages.push({ sequence: entry.id, role: 'assistant', text: question });
      if (entry.type === 'user_message') {
        // Review recovery follows the actual queued input, including automatic
        // openings. Only real learner messages belong in the visible transcript.
        latestInputSequence = entry.id;
        if (!data.pblOpening && typeof data.text === 'string')
          messages.push({ sequence: entry.id, role: 'user', text: data.text });
      }
      if (
        entry.type === 'message_end' &&
        data.message?.role === 'assistant' &&
        Array.isArray(data.message.content)
      ) {
        const text = data.message.content
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('\n');
        if (text) messages.push({ sequence: entry.id, role: 'assistant', text });
      }
    }
    const pending = binding.guided?.pending;
    if (
      latestInputSequence !== undefined &&
      pending?.runId === `${binding.stage_key}:${latestInputSequence}` &&
      !messages.some(
        (m) =>
          m.sequence > latestInputSequence && m.role === 'assistant' && m.text === pending.question,
      )
    )
      messages.push({ sequence: last + 1, role: 'assistant', text: pending.question });
    conversations.push({
      role: binding.role,
      milestone: binding.context_key,
      messages,
      truncated: cursor < last,
    });
  }
  const saved = await store.pool.query<{
    id: string;
    milestone_id: string;
    kind: string;
    actor: string;
    detail: Record<string, unknown>;
  }>(
    'SELECT id,milestone_id,kind,actor,detail FROM pbl_v3_evidence WHERE study_id=$1 ORDER BY id',
    [id],
  );
  for (const item of saved.rows)
    evidence.push({
      sequence: -Number(item.id),
      milestoneId: item.milestone_id,
      kind: item.kind,
      detail: JSON.stringify(
        {
          actor: item.actor,
          ...Object.fromEntries(
            Object.entries(item.detail).filter(
              ([key]) => !['fingerprint', 'previousHash'].includes(key),
            ),
          ),
        },
        null,
        2,
      ),
      ...(typeof item.detail.fingerprint === 'string'
        ? { version: versionLabel(item.detail.fingerprint) }
        : {}),
    });
  const choices = new Map<string, string>();
  let decisionChanges = 0;
  for (const { event } of records.rows)
    if (event.type === 'decision.recorded') {
      const key = `${event.milestoneId}:${event.decisionId}`;
      if (choices.has(key) && choices.get(key) !== event.chosen) decisionChanges++;
      choices.set(key, event.chosen ?? '');
    }
  return {
    facts: {
      learnerTurns: conversations.reduce(
        (n, c) => n + c.messages.filter((m) => m.role === 'user').length,
        0,
      ),
      assistantTurns: conversations.reduce(
        (n, c) => n + c.messages.filter((m) => m.role === 'assistant').length,
        0,
      ),
      decisions: choices.size,
      decisionChanges,
      testRuns: counts['evaluation.recorded'] ?? 0,
      quizAttempts: counts['quiz.recorded'] ?? 0,
      fileEdits: saved.rows.filter((e) => e.kind === 'file-edit').length,
      interruptedRuns,
    },
    studyId: id,
    project: { id: project.ref.id, version: project.ref.version, title: project.definition.title },
    revision: row.revision,
    requiredComplete: row.state.status === 'completed',
    milestones: project.definition.milestones.map((m, i) => ({
      id: m.id,
      title: m.title,
      optional: !!m.optional,
      status: row.state.milestones[i]?.status ?? 'pending',
      stages: m.stages.map((s) =>
        s.kind === 'check' ? s.checker : s.kind === 'produce' ? s.writes : s.kind,
      ),
    })),
    outcomes: project.definition.milestones.map((m) => {
      const collected = row.state.collected[m.id];
      return {
        milestoneId: m.id,
        tests: collected?.tests?.status ?? null,
        quiz: collected?.quiz
          ? {
              score: collected.quiz.score,
              total: collected.quiz.total,
              attempt: collected.quiz.attempt,
            }
          : null,
        reflected: collected?.recapCompleted === true,
      };
    }),
    evidence,
    counts,
    conversations,
    truncated:
      missingConversation ||
      conversations.some((c) => c.truncated) ||
      evidence.some((e) => e.truncated === true),
  };
}

/** Reading is always token-free; unfinished projects have no report surface. */
export async function learningReport(
  principal: OwnerPrincipal,
  id: string,
): Promise<LearningReport> {
  const store = await LearningStore.open();
  const row = await store.get(id, principal.ownerId);
  if (row.state.status !== 'completed')
    throw sandboxConflict(
      'Complete the final project reflection before viewing the report.',
      'WORKBENCH_ACCESS_DENIED',
    );
  const saved = (
    await store.pool.query<{ status: string; document: LearningReport | null; updated_at: Date }>(
      'SELECT status,document,updated_at FROM pbl_v3_reports WHERE study_id=$1 AND completion_revision=$2',
      [id, row.state.completionRevision ?? 1],
    )
  ).rows[0];
  if (saved?.status === 'ready' && saved.document) return saved.document;
  const report = await learningEvidence(principal, id);
  const stale = !!saved && Date.now() - saved.updated_at.getTime() > 120000;
  return {
    ...report,
    analysis: {
      status: stale
        ? 'failed'
        : saved?.status === 'generating'
          ? 'generating'
          : saved?.status === 'failed'
            ? 'failed'
            : 'not_generated',
      findings: [],
      omitted: false,
      canRetry: !saved || saved.status === 'failed' || stale,
    },
  };
}

/** Explicit report-button action. One bounded model call; no new queue or sandbox. */
export async function generateLearningReport(
  principal: OwnerPrincipal,
  id: string,
  signal: AbortSignal,
) {
  const report = await learningReport(principal, id);
  if (report.analysis?.status === 'ready' || report.analysis?.status === 'generating')
    return report;
  const store = await LearningStore.open();
  const row = await store.get(id, principal.ownerId);
  const attempt = randomUUID();
  const claim = await store.pool.query(
    `INSERT INTO pbl_v3_reports(study_id,completion_revision,attempt,status) VALUES($1,$2,$3,'generating')
     ON CONFLICT(study_id) DO UPDATE SET completion_revision=$2,attempt=$3,status='generating',document=NULL,updated_at=now()
     WHERE pbl_v3_reports.status='failed' OR pbl_v3_reports.updated_at<now()-interval '2 minutes'
       OR pbl_v3_reports.completion_revision<>$2 RETURNING study_id`,
    [id, row.state.completionRevision ?? 1, attempt],
  );
  if (!claim.rows.length) return learningReport(principal, id);
  try {
    const analysis = await analyzeLearningReport(principal.ownerId, report, signal);
    const document: LearningReport = {
      ...report,
      analysis: {
        ...analysis,
        status: 'ready',
        generatedAt: new Date().toISOString(),
        canRetry: false,
      },
    };
    await store.pool.query(
      `UPDATE pbl_v3_reports SET status='ready',document=$3,updated_at=now() WHERE study_id=$1 AND attempt=$2`,
      [id, attempt, JSON.stringify(document)],
    );
    return learningReport(principal, id);
  } catch {
    await store.pool.query(
      `UPDATE pbl_v3_reports SET status='failed',updated_at=now() WHERE study_id=$1 AND attempt=$2`,
      [id, attempt],
    );
    return learningReport(principal, id);
  }
}
