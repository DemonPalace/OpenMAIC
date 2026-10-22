// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ getClientTranslation: (key: string) => key }));
import { useProjectEditor } from '@/components/scene-renderers/pbl/v3/use-project-editor';
import {
  readEditorDraft,
  useStudyDraft,
} from '@/components/scene-renderers/pbl/v3/use-project-drafts';
import type { LearningView } from '@/lib/pbl/v3/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined,
  container: HTMLDivElement,
  sequence = 0;
let editor: ReturnType<typeof useProjectEditor>, ui: ReturnType<typeof useStudyDraft>;
const read = vi.fn(async () => ({ text: 'Saved source', hash: 'a'.repeat(64) }));
const save = vi.fn(async () => true),
  error = vi.fn();
const view = (id: string, environmentId = 'environment-one') =>
  ({
    id,
    environmentId,
    environment: { ready: true },
    files: ['PLAN.md', 'main.py'],
    revision: 1,
  }) as LearningView;
function Editor({ value }: { value: LearningView }) {
  const current = useProjectEditor(value, read, save, error);
  useEffect(() => {
    editor = current;
  });
  return null;
}
function Ui({ id }: { id: string }) {
  const current = useStudyDraft(id, error);
  useEffect(() => {
    ui = current;
  });
  return null;
}
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}
async function leave() {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
}
afterEach(async () => {
  await leave();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  read.mockClear();
  save.mockClear();
  error.mockClear();
});

describe('study-scoped local drafts', () => {
  it('retains dirty file tabs on scene return, isolates another study and refuses to save into a replaced environment', async () => {
    const id = `editor-${sequence++}`;
    await mount(createElement(Editor, { value: view(id) }));
    await act(async () => editor.edit('Unsent plan'));
    await act(async () => editor.select('main.py'));
    await act(async () => editor.edit('Unsent code'));
    await leave();
    read.mockClear();
    await mount(createElement(Editor, { value: view(id) }));
    expect(editor.path).toBe('main.py');
    expect(editor.tabs).toEqual(['PLAN.md', 'main.py']);
    expect(editor.buffer?.text).toBe('Unsent code');
    expect(editor.dirty('PLAN.md')).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await leave();
    await mount(createElement(Editor, { value: view(id, 'environment-two') }));
    expect(editor.stale).toBe(true);
    expect(editor.buffer?.text).toBe('Unsent code');
    await act(async () => editor.save());
    expect(save).not.toHaveBeenCalled();
    await leave();
    await mount(createElement(Editor, { value: view(`another-${sequence++}`) }));
    expect(editor.buffer?.text).toBe('Saved source');
    expect(editor.anyDirty).toBe(false);
  });
  it('does not let a late save acknowledgement erase a newer draft after scene navigation', async () => {
    const id = `late-${sequence++}`;
    let release!: (value: boolean) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await mount(createElement(Editor, { value: view(id) }));
    await act(async () => editor.edit('Submitted source'));
    let pending!: Promise<void>;
    await act(async () => {
      pending = editor.save();
    });
    await leave();
    await mount(createElement(Editor, { value: view(id) }));
    await act(async () => editor.edit('Newer unsaved source'));
    await act(async () => {
      release(true);
      await pending;
    });
    expect(readEditorDraft(id).buffers['PLAN.md']?.text).toBe('Newer unsaved source');
    expect(editor.buffer?.text).toBe('Newer unsaved source');
  });
  it('preserves chat, incomplete quiz choices and pane selection; a late send clears only its submitted text', async () => {
    const id = `ui-${sequence++}`;
    await mount(createElement(Ui, { id }));
    await act(async () => {
      ui.setText('My unsent explanation');
      ui.setShowWorkspace(false);
      const values: number[] = [];
      values[1] = 0;
      ui.setQuizAnswers({ key: 'milestone:5', values });
    });
    const acknowledged = ui.setText;
    await leave();
    await mount(createElement(Ui, { id }));
    expect(ui.text).toBe('My unsent explanation');
    expect(ui.showWorkspace).toBe(false);
    expect(ui.quizAnswers).toEqual({ key: 'milestone:5', values: [null, 0] });
    await leave();
    await act(async () => acknowledged((text) => (text === 'My unsent explanation' ? '' : text)));
    await mount(createElement(Ui, { id }));
    expect(ui.text).toBe('');
    await act(async () => ui.setText('A newer explanation'));
    await act(async () => acknowledged((text) => (text === 'My unsent explanation' ? '' : text)));
    await leave();
    await mount(createElement(Ui, { id }));
    expect(ui.text).toBe('A newer explanation');
  });
  it('keeps scene-return drafts in memory and reports unavailable browser storage', async () => {
    const id = `quota-${sequence++}`;
    const storage = window.sessionStorage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({
      length: storage.length,
      clear: storage.clear.bind(storage),
      getItem: storage.getItem.bind(storage),
      key: storage.key.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    });
    await mount(createElement(Editor, { value: view(id) }));
    await act(async () => editor.edit('Copy this before leaving the page'));
    expect(error).toHaveBeenCalledWith('pblV3.draftStorageUnavailable');
    await leave();
    await mount(createElement(Editor, { value: view(id) }));
    expect(editor.buffer?.text).toBe('Copy this before leaving the page');
  });
});
