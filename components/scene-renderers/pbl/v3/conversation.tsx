'use client';
import { useEffect, useRef } from 'react';
import { Route, Code2, GraduationCap, ListChecks, MessageSquareText } from 'lucide-react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { TextBlock } from '@/components/workbench/chat/text-block';
import { wbStyles } from '@/components/workbench/chat/chat-styles';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LearningView } from '@/lib/pbl/v3/types';
import type { LearningConversationEntry } from '@/lib/pbl/v3/conversation';

// OpenPBL's explicit-send reanchor rule, using the host's existing sticky-scroll implementation.
function FollowSend({ count }: { count: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  const previous = useRef(count);
  useEffect(() => {
    if (previous.current !== count) {
      previous.current = count;
      void scrollToBottom();
    }
  }, [count, scrollToBottom]);
  return null;
}
const accents = {
  mentor: 'border-violet-200 dark:border-violet-900',
  discussion: 'border-sky-200 dark:border-sky-900',
  planner: 'border-emerald-200 dark:border-emerald-900',
  coder: 'border-amber-200 dark:border-amber-900',
};
const icons = {
  mentor: GraduationCap,
  discussion: MessageSquareText,
  planner: ListChecks,
  coder: Code2,
};
export function LearningConversation({ view, sent }: { view: LearningView; sent: number }) {
  const { t } = useI18n();
  const entries: LearningConversationEntry[] =
    view.conversation ??
    view.messages.map((m, i) => ({
      id: `${i}`,
      speaker: m.role === 'user' ? 'user' : (view.role ?? 'mentor'),
      parts: [{ kind: 'text', id: `${i}`, text: m.text }],
    }));
  return (
    <Conversation className="min-h-0 flex-1 bg-background" aria-label={t('pblV3.learning')}>
      <FollowSend count={sent} />
      <ConversationContent className="gap-5 p-4">
        {!entries.length && (
          <p className="text-sm text-muted-foreground">{t('pblV3.journey.startConversation')}</p>
        )}
        {entries.map((entry) => {
          if (entry.boundary)
            return (
              <div
                key={entry.id}
                role="separator"
                className="flex items-center gap-3 py-2 text-[11px] text-muted-foreground"
              >
                <span className="h-px flex-1 bg-border" />
                <Route size={13} />
                <span>
                  M{entry.boundary.milestoneIndex + 1} · {entry.boundary.milestoneTitle} ·{' '}
                  {entry.boundary.stageIndex + 1}/{entry.boundary.total}{' '}
                  {t(`pblV3.journey.steps.${entry.boundary.step}`)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          const user = entry.speaker === 'user';
          const Icon = icons[user ? 'mentor' : (entry.speaker as keyof typeof icons)];
          return (
            <article key={entry.id} className={user ? wbStyles.userBubble.row : 'min-w-0'}>
              <div
                className={
                  user
                    ? wbStyles.userBubble.bubble
                    : `pbl-assistant-bubble space-y-3 rounded-xl border p-4 ${accents[entry.speaker as keyof typeof accents]}`
                }
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {!user && <Icon size={15} />}
                  {t(user ? 'pblV3.learner' : `pblV3.roles.${entry.speaker}`)}
                </div>
                {entry.parts.map((part) =>
                  part.kind === 'text' ? (
                    <div key={part.id}>
                      {user ? (
                        <p className="whitespace-pre-wrap">{part.text}</p>
                      ) : (
                        <TextBlock text={part.text} streaming={part.streaming} />
                      )}
                    </div>
                  ) : (
                    <details key={part.id} className="rounded-lg border bg-background text-sm">
                      <summary className="flex cursor-pointer items-center gap-2 p-2">
                        <span
                          className={wbStyles.statusDot}
                          data-kind={
                            part.status === 'succeeded'
                              ? 'ok'
                              : part.status === 'failed'
                                ? 'error'
                                : part.status === 'running'
                                  ? 'running'
                                  : 'suspended'
                          }
                        />
                        <span>{t(`pblV3.activity.${part.action}`)}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t(`pblV3.activity.${part.status}`)}
                        </span>
                      </summary>
                      <p className="border-t p-3 text-xs text-muted-foreground">
                        {t(`pblV3.activity.${part.action}Hint`)}
                      </p>
                    </details>
                  ),
                )}
              </div>
            </article>
          );
        })}
        {view.busy && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={wbStyles.statusDot} data-kind="running" />
            {t('pblV3.thinking')}
          </p>
        )}
      </ConversationContent>
      <ConversationScrollButton aria-label={t('pblV3.journey.latest')} />
    </Conversation>
  );
}
