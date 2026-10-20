'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LearningView } from '@/lib/pbl/v3/types';
import type { LearningReport } from '@/lib/pbl/v3/report';
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
    <div className="mb-4 space-y-3">
      <nav aria-label={t('pblV3.learningPath')} className="rounded border p-3">
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
                  {t(
                    `pblV3.stageNames.${m.stages[view.state.position.stageIndex] ?? 'mentor_say'}`,
                  )}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {view.stage.kind === 'produce' && view.stage.exploration && (
        <p className="rounded border p-3">{view.stage.exploration.introduction}</p>
      )}
      <button
        className={button}
        onClick={() => {
          if (!open) setAttempt((n) => n + 1);
          setOpen((v) => !v);
        }}
      >
        {t(open ? 'pblV3.backLearning' : 'pblV3.report')}
      </button>
      {open && (
        <section aria-label={t('pblV3.report')} className="space-y-3 rounded border p-4">
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
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">
                    {item.detail}
                  </pre>
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
