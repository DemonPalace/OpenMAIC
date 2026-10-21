'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LearningView } from '@/lib/pbl/v3/types';
import type { LearningReport } from '@/lib/pbl/v3/report';
import { learningStep } from '@/lib/pbl/v3/presentation';
import { TextBlock } from '@/components/workbench/chat/text-block';
import { sandboxErrorMessage } from '@/lib/sandbox/error-message';

export function LearningPanels({ view }: { view: LearningView }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; report: LearningReport } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = `${view.id}:${attempt}`;
  const report = result?.key === key ? result.report : null;
  const error = failure?.key === key ? failure.message : '';
  const loading = !report && !error;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(`/api/pbl/v3/report?id=${encodeURIComponent(view.id)}`, {
      headers: { 'x-openmaic-sandbox': '1' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(sandboxErrorMessage(data.error));
        return data as LearningReport;
      })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, report: data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setFailure({ key, message: e.message });
      });
    return () => controller.abort();
  }, [open, view.id, key]);
  const button = 'rounded border px-3 py-2 text-sm disabled:opacity-40';
  return (
    <div className="contents">
      <details className="text-xs">
        <summary className="cursor-pointer rounded border px-2 py-2">
          {t('pblV3.learningPath')}
        </summary>
        <nav
          aria-label={t('pblV3.learningPath')}
          className="absolute right-2 top-12 z-20 max-h-80 max-w-[90%] overflow-auto rounded border bg-background p-4 shadow-lg"
        >
          <h3 className="font-semibold">{t('pblV3.learningPath')}</h3>
          <ol className="mt-2 flex flex-wrap gap-3">
            {view.milestones?.map((m, i) => (
              <li
                key={m.id}
                aria-current={i === view.state.position.milestoneIndex ? 'step' : undefined}
                className={i === view.state.position.milestoneIndex ? 'font-semibold' : ''}
              >
                {view.state.milestones[i]?.status === 'completed' ? '✓ ' : `${i + 1}. `}
                {m.title}
                {m.optional ? ` (${t('pblV3.optional')})` : ''}
                {i === view.state.position.milestoneIndex && (
                  <span className="block text-xs text-muted-foreground">
                    {t(`pblV3.journey.steps.${learningStep(view)}`)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </details>
      <button
        className={button}
        onClick={() => {
          if (!open) setAttempt((n) => n + 1);
          setOpen((v) => !v);
        }}
      >
        {t('pblV3.report')}
      </button>
      {open && (
        <section
          aria-label={t('pblV3.report')}
          className="absolute inset-2 z-30 space-y-3 overflow-auto rounded-xl border bg-background p-5 shadow-2xl"
        >
          <button className={button} onClick={() => setOpen(false)}>
            {t('pblV3.backLearning')}
          </button>
          <h3 className="font-semibold">{t('pblV3.report')}</h3>
          <p>{t('pblV3.evidenceReportNotice')}</p>
          {loading && <p role="status">{t('pblV3.loading')}</p>}
          {error && <p role="alert">{error}</p>}
          <button className={button} disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
            {t('pblV3.refresh')}
          </button>
          {report && (
            <>
              <p role="status">
                {t(report.requiredComplete ? 'pblV3.requiredComplete' : 'pblV3.inProgress')}
              </p>
              <ul>
                {report.milestones.map((m) => (
                  <li key={m.id}>
                    {m.status === 'completed' ? '✓ ' : ''}
                    {m.title}
                    {m.optional ? ` (${t('pblV3.optional')})` : ''}
                  </li>
                ))}
              </ul>
              {!!report.outcomes?.length && (
                <section className="space-y-3" aria-label={t('pblV3.journey.outcomes')}>
                  <h4 className="font-semibold">{t('pblV3.journey.outcomes')}</h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    {report.outcomes.map((outcome) => (
                      <article
                        key={outcome.milestoneId}
                        className="rounded-xl border bg-muted/20 p-4"
                      >
                        <h5 className="font-medium">
                          {report.milestones.find((m) => m.id === outcome.milestoneId)?.title}
                        </h5>
                        <p className="mt-2 text-sm">
                          {t('pblV3.stageNames.tests')}:{' '}
                          {outcome.tests ?? t('pblV3.journey.noTests')}
                        </p>
                        <p className="text-sm">
                          {t('pblV3.stageNames.quiz')}:{' '}
                          {outcome.quiz
                            ? `${outcome.quiz.score}/${outcome.quiz.total}`
                            : t('pblV3.journey.noQuiz')}
                        </p>
                        <p className="text-sm">
                          {t(
                            outcome.reflected
                              ? 'pblV3.journey.reflected'
                              : 'pblV3.journey.notReflected',
                          )}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {report.evidence
                            .filter(
                              (e) =>
                                e.milestoneId === outcome.milestoneId &&
                                [
                                  'evaluation.recorded',
                                  'quiz.recorded',
                                  'recap.completed',
                                ].includes(e.kind),
                            )
                            .slice(-3)
                            .map((e) => (
                              <a
                                className="underline"
                                key={e.sequence}
                                href={`#pbl-evidence-${e.sequence}`}
                                onClick={() => {
                                  const target = document.getElementById(
                                    `pbl-evidence-${e.sequence}`,
                                  );
                                  if (target instanceof HTMLDetailsElement) target.open = true;
                                }}
                              >
                                #{e.sequence}{' '}
                                {t(`pblV3.evidenceKinds.${e.kind.replaceAll('.', '_')}`)}
                              </a>
                            ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {report.truncated && <p>{t('pblV3.truncatedEvidence')}</p>}
              <h4 className="font-semibold">{t('pblV3.reportEvidence')}</h4>
              {report.evidence.map((item) => (
                <details
                  id={`pbl-evidence-${item.sequence}`}
                  key={item.sequence}
                  className="rounded border p-2"
                >
                  <summary>
                    <a href={`#pbl-evidence-${item.sequence}`}>#{item.sequence}</a> ·{' '}
                    {report.milestones.find((m) => m.id === item.milestoneId)?.title} ·{' '}
                    {t(`pblV3.evidenceKinds.${item.kind.replaceAll('.', '_')}`)}
                  </summary>
                  <div className="max-h-64 overflow-auto text-sm">
                    <TextBlock text={item.detail} />
                  </div>
                  {item.version && (
                    <p className="break-all text-xs text-muted-foreground">
                      {t('pblV3.evidenceVersion')}: {item.version}
                    </p>
                  )}
                </details>
              ))}
              <h4 className="font-semibold">{t('pblV3.reportConversations')}</h4>
              {report.conversations.map((c) => (
                <details key={`${c.role}:${c.milestone}`} className="rounded border p-2">
                  <summary>
                    {t(`pblV3.roles.${c.role}`)} ·{' '}
                    {report.milestones.find((m) => m.id === c.milestone)?.title ??
                      report.project.title}
                  </summary>
                  {c.truncated && <p>{t('pblV3.truncatedEvidence')}</p>}
                  {c.messages.map((m) => (
                    <p key={m.sequence} className="my-2 whitespace-pre-wrap text-sm">
                      <span className="font-semibold">
                        {m.role === 'user' ? t('pblV3.learner') : t(`pblV3.roles.${c.role}`)}
                      </span>
                      : {m.text}
                    </p>
                  ))}
                </details>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
