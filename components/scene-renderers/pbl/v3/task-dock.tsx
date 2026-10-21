'use client';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { learningProgress, learningStep } from '@/lib/pbl/v3/presentation';
import type { LearningView } from '@/lib/pbl/v3/types';

/** Task details float over the transcript; they never push the composer out of view. */
export function TaskDock({
  view,
  children,
  action,
}: {
  view: LearningView;
  children: ReactNode;
  action: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const key = `${view.id}:${view.state.introCompleted}:${view.state.position.milestoneId}:${view.state.position.stageIndex}`;
  const [openKey, setOpenKey] = useState<string | null>(
    view.decisions.length || view.questions.length ? key : null,
  );
  const open = openKey === key;
  const progress = learningProgress(view);
  const step = learningStep(view);
  const hint = t(
    view.busy
      ? 'pblV3.thinking'
      : view.actions.includes('next')
        ? 'pblV3.journey.ready'
        : `pblV3.journey.hints.${step}`,
  );
  const close = () => {
    setOpenKey(null);
    toggle.current?.focus();
  };
  return (
    <section
      className="pbl-task-dock relative shrink-0 border-t bg-background"
      aria-label={t('pblV3.journey.currentTask')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div
        id={id}
        hidden={!open}
        role="region"
        aria-label={t('pblV3.journey.taskDetails')}
        className="pbl-task-drawer absolute inset-x-0 bottom-full z-20 overflow-auto border-b bg-popover p-4 shadow-xl"
      >
        <header className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold">{view.task?.title ?? view.title}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t(`pblV3.journey.hints.${step}`)}</p>
          </div>
          <button
            type="button"
            className="rounded p-1 hover:bg-muted"
            onClick={close}
            aria-label={t('pblV3.journey.closeDetails')}
          >
            <X size={16} />
          </button>
        </header>
        {view.task?.goal && <p className="mb-3 text-sm">{view.task.goal}</p>}
        <ol
          className="mb-3 grid grid-cols-2 gap-2 text-xs"
          aria-label={t('pblV3.journey.milestoneSteps')}
        >
          {progress.steps.map((item, i) => (
            <li
              key={i}
              aria-current={item.active ? 'step' : undefined}
              className={`rounded border px-2 py-1.5 ${item.active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}
            >
              {item.complete ? '✓' : i + 1}. {t(`pblV3.journey.steps.${item.label}`)}
            </li>
          ))}
        </ol>
        <div className="space-y-3 text-sm">{children}</div>
      </div>
      <div className="flex min-h-11 items-center gap-2 px-3 py-2">
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={id}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
          onClick={() => setOpenKey(open ? null : key)}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${view.busy ? 'animate-pulse bg-primary' : 'bg-muted-foreground'}`}
          />
          {progress.total > 0 && (
            <span className="shrink-0 text-muted-foreground">
              {progress.current}/{progress.total}
            </span>
          )}
          <strong className="shrink-0">{t(`pblV3.journey.steps.${step}`)}</strong>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={hint}>
            {hint}
          </span>
          <ChevronUp
            size={14}
            className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
          <span className="sr-only">{t('pblV3.journey.taskDetails')}</span>
        </button>
        {action}
      </div>
    </section>
  );
}
