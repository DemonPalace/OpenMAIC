'use client';
import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { z } from 'zod';

const bufferSchema = z.object({
  text: z.string(),
  saved: z.string(),
  hash: z.string(),
  environment: z.string(),
});
const editorSchema = z
  .object({
    path: z.string(),
    tabs: z.array(z.string()).max(256),
    buffers: z.record(z.string(), bufferSchema),
  })
  .refine((draft) => draft.tabs.includes(draft.path));
const uiSchema = z
  .object({
    text: z.string(),
    quizAnswers: z.object({
      key: z.string(),
      values: z.array(z.number().int().nonnegative().nullable()).max(256),
    }),
    showWorkspace: z.boolean(),
    showAssistant: z.boolean(),
  })
  .refine((draft) => draft.showWorkspace || draft.showAssistant);
export type EditorBuffer = z.infer<typeof bufferSchema>;
export type EditorDraft = z.infer<typeof editorSchema>;
type StudyDraft = z.infer<typeof uiSchema>;
const emptyEditor = (): EditorDraft => ({ path: 'PLAN.md', tabs: ['PLAN.md'], buffers: {} });
const emptyUi = (): StudyDraft => ({
  text: '',
  quizAnswers: { key: '', values: [] },
  showWorkspace: true,
  showAssistant: true,
});
// Only local drafts, loaded after the server has resolved an owned study. Never cache
// permissions, execution requests, preview grants or terminal input for replay.
const memory = new Map<string, unknown>();
const changed = 'pbl-local-draft-changed';
const key = (id: string, part: string) => `maic:pbl-draft:v1:${id}:${part}`;
function read<T>(id: string, part: string, schema: z.ZodType<T>, fallback: () => T): T {
  const name = key(id, part);
  try {
    const value = memory.get(name) ?? JSON.parse(window.sessionStorage.getItem(name) ?? 'null');
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback();
  } catch {
    return fallback();
  }
}
function write(id: string, part: string, value: unknown): boolean {
  const name = key(id, part);
  memory.set(name, value); // Scene navigation still works if browser storage is full/unavailable.
  let saved = true;
  try {
    window.sessionStorage.setItem(name, JSON.stringify(value));
  } catch {
    saved = false;
  }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new window.CustomEvent(changed, { detail: name }));
  return saved;
}
export const readEditorDraft = (id: string) => read(id, 'editor', editorSchema, emptyEditor);
export function saveEditorDraft(id: string, draft: EditorDraft) {
  return write(id, 'editor', {
    ...draft,
    // Clean files are reread from the authoritative workspace on return.
    buffers: Object.fromEntries(
      Object.entries(draft.buffers).filter(([, b]) => b.text !== b.saved),
    ),
  });
}
export function hasEditorDraft(id: string) {
  return Object.values(readEditorDraft(id).buffers).some((b) => b.text !== b.saved);
}
export function useStudyDraft(id: string | undefined, onStorageError: () => void) {
  const [state, setState] = useState<{ id?: string; value: StudyDraft }>({ value: emptyUi() });
  useEffect(() => {
    if (!id) return;
    const restore = () => setState({ id, value: read(id, 'ui', uiSchema, emptyUi) });
    const receive = (event: Event) => {
      if ((event as CustomEvent).detail === key(id, 'ui')) restore();
    };
    restore();
    window.addEventListener(changed, receive);
    return () => window.removeEventListener(changed, receive);
  }, [id]);
  const update = useCallback(
    (change: (previous: StudyDraft) => StudyDraft) => {
      if (!id) return;
      const next = change(read(id, 'ui', uiSchema, emptyUi));
      // A late successful send clears only its submitted text, including after scene return.
      if (!write(id, 'ui', next)) onStorageError();
    },
    [id, onStorageError],
  );
  const setText = useCallback(
    (next: SetStateAction<string>) =>
      update((previous) => ({
        ...previous,
        text: typeof next === 'function' ? next(previous.text) : next,
      })),
    [update],
  );
  const setQuizAnswers = useCallback(
    (next: SetStateAction<StudyDraft['quizAnswers']>) =>
      update((previous) => {
        const selection = typeof next === 'function' ? next(previous.quizAnswers) : next;
        return {
          ...previous,
          quizAnswers: {
            ...selection,
            values: Array.from(selection.values, (value) => value ?? null),
          },
        };
      }),
    [update],
  );
  const setShowWorkspace = useCallback(
    (value: boolean) => update((previous) => ({ ...previous, showWorkspace: value })),
    [update],
  );
  const setShowAssistant = useCallback(
    (value: boolean) => update((previous) => ({ ...previous, showAssistant: value })),
    [update],
  );
  return {
    ...(state.id === id ? state.value : emptyUi()),
    setText,
    setQuizAnswers,
    setShowWorkspace,
    setShowAssistant,
  };
}
