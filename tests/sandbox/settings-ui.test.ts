import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
const mocked = vi.hoisted(() => ({ request: vi.fn(), t: (key: string) => key }));
vi.mock('@/components/sandbox/client', () => ({ sandboxRequest: mocked.request }));
vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: mocked.t }) }));
vi.mock('next/link', () => ({ default: 'a' }));
import { SandboxSettings } from '@/components/settings/sandbox-settings';
let root: Root;
let host: HTMLElement;
const view = () => ({
  revision: 0,
  source: 'environment',
  fields: {
    enabled: true,
    provider: 'e2b-compatible',
    connectionId: 'test',
    apiUrl: 'https://api.e2b.dev',
    domain: 'e2b.app',
    template: 'code',
    desktopTemplate: '',
    lifetimeMs: 300000,
    maxActive: 5,
    maxActivePerOwner: 1,
  },
  keySet: true,
  keyUnreadable: false,
  configured: true,
  activeEnvironments: 0,
  previewConfigured: true,
  checkpointConfigured: true,
});
beforeEach(async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.defineProperty(document, 'oninput', { value: null, configurable: true });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { userAgent: 'test' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  host = document.getElementById('root')!;
  root = createRoot(host);
  mocked.request.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const button = (key: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === `sandbox.settings.${key}`)!;
it('adopts environment settings without reading or submitting an existing key', async () => {
  mocked.request
    .mockResolvedValueOnce(view())
    .mockResolvedValueOnce({ ...view(), source: 'settings', revision: 1 });
  await act(async () => root.render(createElement(SandboxSettings)));
  expect(host.querySelector<HTMLInputElement>('#sandbox-key')!.value).toBe('');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/project-workspace/sandbox-project');
  await act(async () => button('save').click());
  expect(mocked.request).toHaveBeenLastCalledWith('/api/sandbox/settings', 'PUT', {
    revision: 0,
    fields: view().fields,
  });
  expect(host.textContent).toContain('sandbox.settings.saved');
  expect(host.textContent).toContain('sandbox.settings.settings');
  expect(button('save').disabled).toBe(true);
});
it('locks editing while environments remain outstanding', async () => {
  mocked.request.mockResolvedValue({ ...view(), activeEnvironments: 1 });
  await act(async () => root.render(createElement(SandboxSettings)));
  expect(host.querySelector('fieldset')!.hasAttribute('disabled')).toBe(true);
  expect(button('save').disabled).toBe(true);
  expect(host.textContent).toContain('sandbox.settings.activeWarning');
});
it('shows denied access without rendering editable configuration', async () => {
  mocked.request.mockRejectedValue(new Error('Administrator only'));
  await act(async () => root.render(createElement(SandboxSettings)));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Administrator only');
  expect(host.querySelector('#sandbox-key')).toBeNull();
});
