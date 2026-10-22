'use client';
import { FileText, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LearningView } from '@/lib/pbl/v3/types';
import type { LearningReport } from '@/lib/pbl/v3/report';
import { learningProgress } from '@/lib/pbl/v3/presentation';
import { TextBlock } from '@/components/workbench/chat/text-block';
import { sandboxErrorMessage } from '@/lib/sandbox/error-message';

export function LearningPanels({ view }: { view: LearningView }) {
  const { t } = useI18n();
  const progress = learningProgress(view);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <div className="contents">
      <div ref={wrap} className="relative flex min-w-0 items-center text-xs">
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-label={t('pblV3.learningPath')}
          title={`M${view.state.position.milestoneIndex + 1} · ${view.milestones?.[view.state.position.milestoneIndex]?.title ?? ''}`}
          onClick={() => setOpen(!open)}
          className="inline-flex h-7 items-center gap-2 rounded-md bg-muted px-3 hover:bg-accent"
        >
          <strong className="font-mono">M{view.state.position.milestoneIndex + 1}</strong>
          <span className="flex gap-0.5" aria-hidden="true">
            {progress.steps.map((step, index) => (
              <i
                key={index}
                className={`h-1 w-2 rounded-full ${step.complete || step.active ? 'bg-primary' : 'bg-muted-foreground/25'}`}
              />
            ))}
          </span>
          {progress.total > 0 && (
            <span className="font-mono text-muted-foreground">
              {progress.current}/{progress.total}
            </span>
          )}
        </button>
        {open && (
          <nav
            aria-label={t('pblV3.learningPath')}
            className="absolute right-0 top-[calc(100%+6px)] z-30 max-h-[min(24rem,60dvh)] w-max min-w-64 max-w-[min(32rem,80vw)] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
          >
            <h3 className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
              {t('pblV3.learningPath')}
            </h3>
            <ol className="py-1">
              {view.milestones?.map((m, i) => {
                const status = view.state.milestones.find(
                  (item) => item.milestoneId === m.id,
                )?.status;
                const active = i === view.state.position.milestoneIndex;
                const done = status === 'completed';
                return (
                  <li
                    key={m.id}
                    aria-current={active ? 'step' : undefined}
                    data-state={done ? 'done' : active ? 'active' : 'pending'}
                    className={`flex min-h-8 items-center gap-2 rounded-md px-3 py-1 ${active ? 'font-semibold' : 'text-muted-foreground'}`}
                    title={`M${i + 1} · ${m.title}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${done ? 'bg-emerald-500' : active ? 'bg-primary' : 'bg-muted-foreground/25'}`}
                    />
                    <span className="shrink-0 font-mono text-muted-foreground">M{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    {active && (
                      <span className="shrink-0 font-mono font-normal text-muted-foreground">
                        {progress.current}/{progress.total}
                      </span>
                    )}
                    {done && <Check size={12} aria-label={t('pblV3.completed')} />}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </div>
      {view.reportAvailable && <ProjectReport view={view} />}
    </div>
  );
}

function ProjectReport({ view }: { view: LearningView }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false);
  const [report, setReport] = useState<LearningReport | null>(null),
    [error, setError] = useState('');
  const load = async (method: 'GET' | 'POST') => {
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/pbl/v3/report?id=${encodeURIComponent(view.id)}`, {
        method,
        headers: { 'x-openmaic-sandbox': '1', 'content-type': 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(sandboxErrorMessage(data.error));
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pblV3.reportCopy.failed'));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (!open || pending || report?.analysis?.status !== 'generating') return;
    const timer = setTimeout(() => void load('GET'), 2000);
    return () => clearTimeout(timer);
  }, [open, pending, report]); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceId = (id: string) => `report-source-${id.replaceAll(':', '-')}`;
  const cite = (id: string) => {
    const target = document.getElementById(sourceId(id));
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const button = 'rounded-md border px-3 py-2 text-sm disabled:opacity-40';
  return (
    <>
      <button
        className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-xs text-white"
        aria-label={t('pblV3.report')}
        disabled={view.busy}
        onClick={() => {
          setOpen(true);
          void load('POST');
        }}
      >
        <FileText size={14} />
        {t('pblV3.report')}
      </button>
      {open && (
        <section
          aria-label={t('pblV3.report')}
          className="absolute inset-0 z-40 overflow-auto bg-background p-4 text-foreground sm:p-8"
        >
          <div className="mx-auto max-w-4xl space-y-6">
            <button className={button} onClick={() => setOpen(false)}>
              {t('pblV3.backLearning')}
            </button>
            <header>
              <p className="text-sm text-muted-foreground">{view.title}</p>
              <h2 className="text-2xl font-semibold">{t('pblV3.report')}</h2>
            </header>
            {(pending || report?.analysis?.status === 'generating') && (
              <p role="status">{t('pblV3.reportCopy.generating')}</p>
            )}
            {error && <p role="alert">{error}</p>}
            {(error || report?.analysis?.canRetry) && !pending && (
              <button className={button} onClick={() => void load('POST')}>
                {t('pblV3.reportCopy.retry')}
              </button>
            )}
            {report?.analysis?.status === 'failed' && (
              <p role="alert">{t('pblV3.reportCopy.failed')}</p>
            )}
            {report && (
              <>
                <p className="text-sm text-muted-foreground">{t('pblV3.evidenceReportNotice')}</p>
                <section className="space-y-3" aria-label={t('pblV3.reportCopy.analysis')}>
                  <h3 className="text-lg font-semibold">{t('pblV3.reportCopy.analysis')}</h3>
                  {report.analysis?.omitted && <p role="status">{t('pblV3.reportCopy.omitted')}</p>}
                  {report.analysis?.findings.map((f, i) => (
                    <article key={i} className="rounded-xl border p-4">
                      <p className="text-xs text-muted-foreground">
                        {t(`pblV3.reportCopy.${f.category}`)}
                      </p>
                      <h4 className="font-semibold">{f.title}</h4>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{f.detail}</p>
                      {f.quote && (
                        <blockquote className="my-3 border-l-2 pl-3 text-sm">{f.quote}</blockquote>
                      )}
                      <div className="mt-2 flex flex-wrap gap-3">
                        {f.evidence.map((id) => (
                          <button key={id} className="text-xs underline" onClick={() => cite(id)}>
                            {t('pblV3.reportCopy.source')} {id.split(':').at(-1)}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </section>
                {report.facts && (
                  <section aria-label={t('pblV3.reportCopy.facts')}>
                    <h3 className="mb-3 text-lg font-semibold">{t('pblV3.reportCopy.facts')}</h3>
                    <p className="mb-3 text-sm text-muted-foreground">
                      {t('pblV3.reportCopy.countNotice')}
                    </p>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {Object.entries(report.facts).map(([key, value]) => (
                        <div className="rounded-lg border p-3" key={key}>
                          <dt className="text-xs text-muted-foreground">
                            {t(`pblV3.reportCopy.${key}`)}
                          </dt>
                          <dd className="text-xl font-semibold">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
                <section>
                  <h3 className="text-lg font-semibold">{t('pblV3.reportCopy.journey')}</h3>
                  <ol className="mt-3 space-y-3">
                    {report.milestones.map((m) => (
                      <li className="rounded-lg border p-3" key={m.id}>
                        <h4 className="font-medium">{m.title}</h4>
                        {report.outcomes
                          ?.filter((o) => o.milestoneId === m.id)
                          .map((o) => (
                            <p className="mt-1 text-sm" key={o.milestoneId}>
                              {t('pblV3.stageNames.tests')}:{' '}
                              {o.tests
                                ? t(`pblV3.testResult.${o.tests}`)
                                : t('pblV3.journey.noTests')}{' '}
                              · {t('pblV3.stageNames.quiz')}:{' '}
                              {o.quiz
                                ? `${o.quiz.score}/${o.quiz.total}`
                                : t('pblV3.journey.noQuiz')}{' '}
                              ·{' '}
                              {t(
                                o.reflected
                                  ? 'pblV3.journey.reflected'
                                  : 'pblV3.journey.notReflected',
                              )}
                            </p>
                          ))}
                      </li>
                    ))}
                  </ol>
                </section>
                <section className="space-y-2">
                  {report.truncated && <p role="status">{t('pblV3.truncatedEvidence')}</p>}
                  <h3 className="text-lg font-semibold">{t('pblV3.reportEvidence')}</h3>
                  {report.evidence.map((e) => (
                    <details
                      id={sourceId(`event:${e.sequence}`)}
                      key={e.sequence}
                      className="rounded border p-3"
                    >
                      <summary className="cursor-pointer text-sm">
                        {report.milestones.find((m) => m.id === e.milestoneId)?.title} ·{' '}
                        {t(`pblV3.evidenceKinds.${e.kind.replaceAll('.', '_')}`)}
                        {e.version ? ` · ${e.version}` : ''}
                      </summary>
                      {e.truncated && <p>{t('pblV3.truncatedEvidence')}</p>}
                      <div className="mt-2 max-h-80 overflow-auto text-sm">
                        <TextBlock text={e.detail} />
                      </div>
                    </details>
                  ))}
                </section>
                <section className="space-y-2">
                  <h3 className="text-lg font-semibold">{t('pblV3.reportConversations')}</h3>
                  {report.conversations.flatMap((c, i) =>
                    c.messages.map((m) => (
                      <details
                        id={sourceId(`turn:${i}:${m.sequence}`)}
                        key={`${i}:${m.sequence}`}
                        className="rounded border p-3"
                      >
                        <summary className="cursor-pointer text-sm">
                          {m.role === 'user' ? t('pblV3.learner') : t(`pblV3.roles.${c.role}`)} ·{' '}
                          {report.milestones.find((x) => x.id === c.milestone)?.title ??
                            report.project.title}
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-sm">{m.text}</p>
                      </details>
                    )),
                  )}
                </section>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
