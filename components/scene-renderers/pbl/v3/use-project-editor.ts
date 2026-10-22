'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readEditorDraft, saveEditorDraft, type EditorBuffer } from './use-project-drafts';
import { getClientTranslation } from '@/lib/i18n';
import type { LearningView } from '@/lib/pbl/v3/types';

export function useProjectEditor(
  view: LearningView,
  read: (path: string) => Promise<{ text: string; hash: string }>,
  onSave: (path: string, text: string, hash: string) => Promise<boolean>,
  onError: (error: string) => void,
) {
  const [initial] = useState(() => readEditorDraft(view.id));
  const [path, setPath] = useState(initial.path);
  const [tabs, setTabs] = useState(initial.tabs.length ? initial.tabs : ['PLAN.md']);
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>(initial.buffers);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const current = useRef({ view, buffers, read, onError, onSave, path });
  useEffect(() => {
    if (!saveEditorDraft(view.id, { path, tabs, buffers }))
      onError(getClientTranslation('pblV3.draftStorageUnavailable'));
  }, [view.id, path, tabs, buffers, onError]);
  current.current = { view, buffers, read, onError, onSave, path };
  const dirty = (name: string) => !!buffers[name] && buffers[name].text !== buffers[name].saved;
  const load = useCallback(async () => {
    const { view, path, read } = current.current;
    if (!view.environment?.ready || !view.files.includes(path)) return;
    const ticket = ++sequence.current;
    setLoading(true);
    try {
      const result = await read(path);
      if (
        ticket !== sequence.current ||
        view.environmentId !== current.current.view.environmentId ||
        path !== current.current.path
      )
        return;
      setBuffers((previous) => ({
        ...previous,
        [path]: { ...result, saved: result.text, environment: view.environmentId! },
      }));
    } catch (error) {
      current.current.onError((error as Error).message);
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const buffer = current.current.buffers[path];
    if (!buffer || buffer.text === buffer.saved) void load();
    else setLoading(false);
    return () => {
      // Invalidate the latest request, not a DOM ref captured by this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
    };
  }, [path, view.environmentId, view.environment?.ready, view.revision, load]);
  const select = (name: string) => {
    if (name === path) return;
    sequence.current++;
    setTabs((previous) => (previous.includes(name) ? previous : [...previous, name]));
    setPath(name);
  };
  const close = (name: string) => {
    if (tabs.length === 1 && name === 'PLAN.md') {
      void load();
      return;
    }
    if (name === path) {
      sequence.current++;
      setLoading(false);
    }
    setBuffers((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
    const next = tabs.filter((p) => p !== name);
    if (!next.length) next.push('PLAN.md');
    setTabs(next);
    if (path === name) setPath(next.at(-1)!);
  };
  const save = async () => {
    const { path, buffers, view, onSave } = current.current;
    const buffer = buffers[path];
    if (!buffer || buffer.environment !== view.environmentId || !view.files.includes(path)) return;
    if (await onSave(path, buffer.text, buffer.hash)) {
      const cached = readEditorDraft(view.id);
      const submitted = cached.buffers[path];
      if (
        submitted?.environment === buffer.environment &&
        submitted.hash === buffer.hash &&
        submitted.text === buffer.text
      ) {
        // Do not resurrect an acknowledged save on scene return or erase a newer draft.
        delete cached.buffers[path];
        saveEditorDraft(view.id, cached);
      }
      // A late save may mark this submitted version saved, never overwrite a newer local edit.
      setBuffers((previous) =>
        previous[path]
          ? { ...previous, [path]: { ...previous[path], saved: buffer.text } }
          : previous,
      );
      if (current.current.path === path && current.current.buffers[path]?.text === buffer.text)
        await load();
    }
  };
  return {
    path,
    tabs,
    buffer: buffers[path],
    loading,
    dirty,
    anyDirty: Object.values(buffers).some((b) => b.text !== b.saved),
    stale:
      !!buffers[path] &&
      (buffers[path].environment !== view.environmentId || !view.files.includes(path)),
    select,
    close,
    reload: load,
    save,
    edit: (text: string) =>
      setBuffers((previous) =>
        previous[path] ? { ...previous, [path]: { ...previous[path], text } } : previous,
      ),
  };
}
