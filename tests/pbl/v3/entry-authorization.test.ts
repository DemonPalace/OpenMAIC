import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/sandbox/settings', () => ({ resolvedSandboxConfig: vi.fn() }));
vi.mock('@/lib/server/sandbox/store', () => ({ SandboxStore: { open: vi.fn() } }));
vi.mock('@/lib/server/pbl-v3/store', () => ({ LearningStore: { open: vi.fn() } }));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: vi.fn(),
}));
import { openStudy } from '@/lib/server/pbl-v3/runtime';
import { LearningStore } from '@/lib/server/pbl-v3/store';
import { SandboxStore } from '@/lib/server/sandbox/store';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('refuses an anonymous study before creating any durable PBL or sandbox ownership', async () => {
  vi.stubEnv('OWNER_SINGLE_USER', 'false');
  vi.stubEnv('OWNER_SINGLE_USER_ID', '');
  await expect(
    openStudy(
      {
        ownerId: 'anonymous-a',
        kind: 'anonymous',
        assurance: 'verified',
        roles: new Set(['sandbox:use']),
      },
      'classroom',
      'scene',
    ),
  ).rejects.toMatchObject({ code: 'SANDBOX_FORBIDDEN' });
  expect(LearningStore.open).not.toHaveBeenCalled();
  expect(SandboxStore.open).not.toHaveBeenCalled();
  expect(getOwnerScopedDocumentStore).not.toHaveBeenCalled();
});
