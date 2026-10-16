import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('server-only', () => ({}));
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  getInfo: vi.fn(),
  connect: vi.fn(),
  kill: vi.fn(),
}));
vi.mock('e2b', () => ({
  Sandbox: sdk,
  FileNotFoundError: class extends Error {},
  SandboxNotFoundError: class extends Error {},
}));
import { sandboxConfig } from '@/lib/server/sandbox/config';
import { E2BCompatibleSandboxProvider } from '@/lib/server/sandbox/providers/e2b-compatible';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(process.env))
    if (key.startsWith('OPENMAIC_SANDBOX_') || key.startsWith('E2B_')) vi.stubEnv(key, undefined);
  vi.stubEnv('OPENMAIC_SANDBOX_PROVIDER', 'e2b-compatible');
  vi.stubEnv('OPENMAIC_SANDBOX_CONNECTION_ID', 'test-installation');
  vi.stubEnv('OPENMAIC_SANDBOX_TEMPLATE', 'code-template');
  vi.stubEnv('OPENMAIC_SANDBOX_API_KEY', 'test-key');
});
afterEach(() => vi.unstubAllEnvs());

describe('E2B-compatible connection configuration', () => {
  it('defaults to the official endpoint without inheriting SDK globals', () => {
    vi.stubEnv('E2B_API_URL', 'https://unrelated.invalid');
    vi.stubEnv('E2B_DOMAIN', 'unrelated.invalid');
    expect(sandboxConfig()).toMatchObject({ apiUrl: 'https://api.e2b.dev', domain: 'e2b.app' });
  });
  it('requires an explicit API URL for another data-plane domain', () => {
    vi.stubEnv('OPENMAIC_SANDBOX_DOMAIN', 'sandboxes.example.org');
    expect(() => sandboxConfig()).toThrow();
    vi.stubEnv('OPENMAIC_SANDBOX_API_URL', 'https://control.example.org/');
    expect(sandboxConfig().apiUrl).toBe('https://control.example.org');
  });
  it.each([
    'http://api.example.org',
    'https://user:password@api.example.org',
    'https://api.example.org/path',
    'https://api.example.org?token=x',
    'https://api.example.org#fragment',
  ])('refuses ambiguous or insecure API URL %s', (url) => {
    vi.stubEnv('OPENMAIC_SANDBOX_API_URL', url);
    expect(() => sandboxConfig()).toThrow();
  });
  it.each(['host/path', 'https://example.org', 'host:443', 'bad..domain', '-bad.example'])(
    'refuses invalid sandbox domain %s',
    (domain) => {
      vi.stubEnv('OPENMAIC_SANDBOX_DOMAIN', domain);
      vi.stubEnv('OPENMAIC_SANDBOX_API_URL', 'https://api.example.org');
      expect(() => sandboxConfig()).toThrow();
    },
  );
  it('binds API URL into identity but permits same-account key rotation', () => {
    const first = sandboxConfig().fingerprint;
    vi.stubEnv('OPENMAIC_SANDBOX_API_KEY', 'rotated-test-key');
    expect(sandboxConfig().fingerprint).toBe(first);
    vi.stubEnv('OPENMAIC_SANDBOX_API_URL', 'https://other.example.org');
    expect(sandboxConfig().fingerprint).not.toBe(first);
  });
  it.each(['E2B_ACCESS_TOKEN', 'E2B_SANDBOX_URL'])('rejects data-plane override %s', (key) => {
    vi.stubEnv(key, 'unexpected');
    expect(() => sandboxConfig()).toThrow();
  });
  it('does not activate an unconfigured installation', () => {
    vi.stubEnv('OPENMAIC_SANDBOX_PROVIDER', undefined);
    expect(() => sandboxConfig()).toThrow(expect.objectContaining({ code: 'SANDBOX_DISABLED' }));
  });
  it('pins the protocol baseline instead of silently upgrading to v2 create', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies.e2b).toBe('2.31.0');
    expect(pkg.dependencies['@e2b/desktop']).toBe('2.3.1');
  });
});

it.each([
  ['https://api.e2b.dev', 'e2b.app'],
  ['https://control.example.org', 'sandboxes.example.org'],
])('uses the same adapter for %s', async (apiUrl, domain) => {
  vi.stubEnv('OPENMAIC_SANDBOX_API_URL', apiUrl);
  vi.stubEnv('OPENMAIC_SANDBOX_DOMAIN', domain);
  const config = sandboxConfig();
  const provider = new E2BCompatibleSandboxProvider(config);
  sdk.create.mockResolvedValue({
    sandboxId: 'test-resource',
    files: { makeDir: vi.fn().mockResolvedValue(undefined) },
  });
  await expect(provider.create('operation-1', 'code')).resolves.toEqual({
    id: 'test-resource',
    state: 'running',
  });
  expect(sdk.create).toHaveBeenCalledWith(
    'code-template',
    expect.objectContaining({
      apiUrl,
      domain,
      apiKey: 'test-key',
      secure: true,
      network: { allowPublicTraffic: false },
      timeoutMs: 300_000,
      metadata: { openmaic_connection: 'test-installation', openmaic_operation: 'operation-1' },
    }),
  );
  sdk.getInfo.mockResolvedValue({
    sandboxId: 'test-resource',
    state: 'running',
    metadata: { openmaic_connection: 'test-installation', openmaic_operation: 'another-operation' },
  });
  await expect(provider.destroy('test-resource', 'operation-1')).rejects.toThrow();
  expect(sdk.kill).not.toHaveBeenCalled();
  expect(provider.capabilities).toEqual({ pause: false, desktopStream: false });
});

it('initializes the workspace idempotently through the owned private connection', async () => {
  const provider = new E2BCompatibleSandboxProvider(sandboxConfig());
  const mkdir = vi.fn().mockResolvedValue(true);
  sdk.getInfo.mockResolvedValue({
    sandboxId: 'resource',
    state: 'running',
    endAt: new Date(Date.now() + 300000),
    network: { allowPublicTraffic: false },
    metadata: { openmaic_connection: 'test-installation', openmaic_operation: 'op' },
  });
  sdk.connect.mockResolvedValue({ files: { makeDir: mkdir } });
  await provider.initializeWorkspace('resource', 'op');
  await provider.initializeWorkspace('resource', 'op');
  expect(mkdir).toHaveBeenNthCalledWith(1, '/home/user/project');
  expect(mkdir).toHaveBeenNthCalledWith(2, '/home/user/project');
});
