'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';

/** Native fullscreen keeps a single scene/workspace instance and restores the host classroom on exit. */
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);
  const { t } = useI18n();
  useEffect(() => {
    const change = () => setExpanded(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  return (
    <div
      ref={ref}
      data-testid="pbl-v3-frame"
      className="wbchat relative h-full overflow-auto bg-background text-foreground"
    >
      <div className="sticky top-0 z-10 flex justify-end border-b bg-background/95 px-4 py-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded px-3 py-1 text-sm hover:bg-muted"
          onClick={async () => {
            setError(false);
            try {
              if (expanded) await document.exitFullscreen();
              else await ref.current?.requestFullscreen();
            } catch {
              setError(true);
            }
          }}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {t(expanded ? 'pblV3.journey.returnClassroom' : 'pblV3.journey.expand')}
        </button>
      </div>
      {error && (
        <p role="alert" className="px-4 text-sm">
          {t('pblV3.journey.fullscreenUnavailable')}
        </p>
      )}
      {children}
    </div>
  );
}
