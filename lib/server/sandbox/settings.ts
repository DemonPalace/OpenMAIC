import 'server-only';
import { z } from 'zod';
import type { Queryable } from '@openmaic/storage/document/pg';
import { ensureSandboxEnvironmentSchema } from '@/lib/persistence/sandbox-environments';
import { withSchemaBootstrapLock } from '@/lib/persistence/schema-bootstrap-lock';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import {
  isPersonalInstallationOwner,
  OWNER_ROLES,
  type OwnerPrincipal,
} from '@/lib/server/identity';
import { sealSecret, openSecret, type SealedSecret } from '@/lib/server/secret-box';
import { SandboxError, sandboxConflict, sandboxInvalid } from '@/lib/sandbox/errors';
import type { SandboxSettingsFields, SandboxSettingsView } from '@/lib/sandbox/settings';
import { sandboxConfig } from './config';
import { previewConfig } from './preview';
import { CheckpointStorage } from './checkpoint-storage';

const CONTEXT = 'sandbox-installation-key:v1';
export function sandboxSettingsUiEnabled() {
  return process.env.OPENMAIC_SANDBOX_SETTINGS_UI === 'true';
}
export function assertSandboxSettingsUiEnabled() {
  if (!sandboxSettingsUiEnabled())
    throw new SandboxError(
      'SANDBOX_SETTINGS_DISABLED',
      403,
      'Sandbox settings are managed by deployment configuration.',
    );
}
export function assertSandboxSettingsAdmin(principal: OwnerPrincipal) {
  if (isPersonalInstallationOwner(principal)) return;
  if (
    (principal.kind === 'user' || principal.kind === 'service') &&
    principal.assurance === 'verified' &&
    principal.roles.has(OWNER_ROLES.admin)
  )
    return;
  throw new SandboxError(
    'SANDBOX_SETTINGS_FORBIDDEN',
    403,
    'Only the installation administrator can configure sandboxes.',
  );
}
const fieldsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.literal('e2b-compatible'),
    connectionId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,128}$/),
    apiUrl: z.string().trim().max(2048),
    domain: z.string().trim().max(253),
    template: z.string().trim().max(256),
    desktopTemplate: z.string().trim().max(256),
    lifetimeMs: z.number().int().min(60_000).max(3_600_000),
    maxActive: z.number().int().min(1).max(100),
    maxActivePerOwner: z.number().int().min(1).max(20),
  })
  .strict()
  .refine((f) => f.maxActivePerOwner <= f.maxActive);
export const sandboxSettingsInput = z
  .object({
    revision: z.number().int().nonnegative(),
    fields: fieldsSchema,
    apiKey: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();
interface Row {
  config: SandboxSettingsFields;
  secret: SealedSecret | null;
  revision: number;
}
async function persistence() {
  if (!process.env.DATABASE_URL)
    throw new SandboxError(
      'SANDBOX_STORAGE_UNAVAILABLE',
      503,
      'Configure a database before saving sandbox settings.',
    );
  const p = await getServerPersistenceProvider(process.env.DATABASE_URL);
  await withSchemaBootstrapLock(p.pool, ensureSandboxEnvironmentSchema);
  return p;
}
async function readRow(q: Queryable) {
  return (
    await q.query<Row & Record<string, unknown>>(
      'SELECT config,secret,revision FROM sandbox_settings WHERE id=1',
    )
  ).rows[0];
}
function environmentFields(): SandboxSettingsFields {
  const e = process.env;
  return {
    enabled: !!e.OPENMAIC_SANDBOX_PROVIDER,
    provider: 'e2b-compatible',
    connectionId: e.OPENMAIC_SANDBOX_CONNECTION_ID || 'my-installation',
    apiUrl:
      e.OPENMAIC_SANDBOX_API_URL ||
      (e.OPENMAIC_SANDBOX_DOMAIN && e.OPENMAIC_SANDBOX_DOMAIN !== 'e2b.app'
        ? ''
        : 'https://api.e2b.dev'),
    domain: e.OPENMAIC_SANDBOX_DOMAIN || 'e2b.app',
    template: e.OPENMAIC_SANDBOX_TEMPLATE || '',
    desktopTemplate: e.OPENMAIC_SANDBOX_DESKTOP_TEMPLATE || '',
    lifetimeMs: Number(e.OPENMAIC_SANDBOX_LIFETIME_MS || 300000),
    maxActive: Number(e.OPENMAIC_SANDBOX_MAX_ACTIVE || 5),
    maxActivePerOwner: Number(e.OPENMAIC_SANDBOX_MAX_ACTIVE_PER_OWNER || 1),
  };
}
function unpack(row?: Row) {
  let key = '',
    unreadable = false;
  if (!row) key = process.env.OPENMAIC_SANDBOX_API_KEY?.trim() || '';
  else if (row.secret) {
    try {
      key = openSecret(row.secret, CONTEXT);
    } catch {
      unreadable = true;
    }
  }
  return {
    fields: row?.config ?? environmentFields(),
    key,
    unreadable,
    revision: row?.revision ?? 0,
  };
}
function runtimeConfig(f: SandboxSettingsFields, key: string) {
  return sandboxConfig({
    OPENMAIC_SANDBOX_PROVIDER: f.enabled ? f.provider : '',
    OPENMAIC_SANDBOX_CONNECTION_ID: f.connectionId,
    OPENMAIC_SANDBOX_API_URL: f.apiUrl,
    OPENMAIC_SANDBOX_DOMAIN: f.domain,
    OPENMAIC_SANDBOX_TEMPLATE: f.template,
    OPENMAIC_SANDBOX_DESKTOP_TEMPLATE: f.desktopTemplate,
    OPENMAIC_SANDBOX_API_KEY: key,
    OPENMAIC_SANDBOX_LIFETIME_MS: String(f.lifetimeMs),
    OPENMAIC_SANDBOX_MAX_ACTIVE: String(f.maxActive),
    OPENMAIC_SANDBOX_MAX_ACTIVE_PER_OWNER: String(f.maxActivePerOwner),
    E2B_SANDBOX_URL: process.env.E2B_SANDBOX_URL,
    E2B_ACCESS_TOKEN: process.env.E2B_ACCESS_TOKEN,
  });
}
/** Only an explicit deployment opt-in lets saved settings replace environment configuration. */
export async function resolvedSandboxConfig() {
  if (!sandboxSettingsUiEnabled()) return { ...sandboxConfig(), settingsRevision: 0 };
  const p = await persistence();
  const row = await readRow(p.pool);
  if (!row) return { ...sandboxConfig(), settingsRevision: 0 };
  const value = unpack(row);
  if (value.unreadable)
    throw new SandboxError('SANDBOX_KEY_UNREADABLE', 503, 'Re-enter the sandbox key in Settings.');
  return { ...runtimeConfig(value.fields, value.key), settingsRevision: value.revision };
}
export async function sandboxWorkspaceEnabled() {
  if (!process.env.DATABASE_URL) return false;
  if (!sandboxSettingsUiEnabled())
    return (
      process.env.OPENMAIC_SANDBOX_WORKSPACE === 'true' && !!process.env.OPENMAIC_SANDBOX_PROVIDER
    );
  const row = await readRow((await persistence()).pool);
  return row
    ? row.config.enabled
    : process.env.OPENMAIC_SANDBOX_WORKSPACE === 'true' && !!process.env.OPENMAIC_SANDBOX_PROVIDER;
}
async function activeCount(q: Queryable) {
  return Number(
    (
      await q.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM sandbox_environments WHERE state <> 'destroyed'",
      )
    ).rows[0].count,
  );
}
export async function sandboxSettingsView(): Promise<SandboxSettingsView> {
  assertSandboxSettingsUiEnabled();
  const p = await persistence(),
    row = await readRow(p.pool),
    value = unpack(row);
  let configured = false,
    previewConfigured = false;
  try {
    if (row) runtimeConfig(value.fields, value.key);
    else sandboxConfig();
    configured = true;
  } catch {
    /* reported as not configured */
  }
  try {
    previewConfig();
    previewConfigured = true;
  } catch {
    /* optional */
  }
  return {
    revision: value.revision,
    source: row ? 'settings' : 'environment',
    fields: value.fields,
    keySet: !!value.key || !!row?.secret,
    keyUnreadable: value.unreadable,
    configured,
    activeEnvironments: await activeCount(p.pool),
    previewConfigured,
    checkpointConfigured: await new CheckpointStorage(p, async () => {
      throw new Error('Configuration probe cannot mutate checkpoints.');
    }).available(),
  };
}
/** Called under the SAME capacity lock as settings writes, before any paid create. */
export async function assertSandboxSettingsRevision(q: Queryable, revision: number) {
  if (!sandboxSettingsUiEnabled()) {
    if (revision !== 0)
      throw sandboxConflict('Sandbox configuration mode changed. Refresh and try again.');
    return;
  }
  if (((await readRow(q))?.revision ?? 0) !== revision)
    throw sandboxConflict('Sandbox settings changed. Refresh and try again.');
}
export async function saveSandboxSettings(raw: unknown) {
  assertSandboxSettingsUiEnabled();
  const parsed = sandboxSettingsInput.safeParse(raw);
  if (!parsed.success) throw sandboxInvalid('Check the sandbox fields and limits.');
  const input = parsed.data,
    p = await persistence();
  await p.withTransaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('openmaic.sandbox.capacity', 0))",
    );
    const row = await readRow(tx),
      previous = unpack(row);
    if (previous.revision !== input.revision)
      throw sandboxConflict('Sandbox settings changed. Refresh before saving.');
    if (await activeCount(tx))
      throw sandboxConflict(
        'Release or reconcile all environments before changing sandbox settings.',
      );
    const connectionChanged = ['apiUrl', 'domain', 'connectionId'].some(
      (k) =>
        input.fields[k as keyof SandboxSettingsFields] !==
        previous.fields[k as keyof SandboxSettingsFields],
    );
    if (connectionChanged && !input.apiKey && (previous.key || previous.unreadable))
      throw sandboxInvalid('Enter a new key when changing the account or endpoint.');
    if (previous.unreadable && !input.apiKey && input.fields.enabled)
      throw sandboxInvalid('The saved key cannot be decrypted. Enter it again.');
    const key = input.apiKey ?? previous.key;
    if (input.fields.enabled) {
      try {
        runtimeConfig(input.fields, key);
      } catch {
        throw sandboxInvalid('A valid HTTPS API endpoint, domain, template and key are required.');
      }
    }
    const secret = key ? sealSecret(key, CONTEXT) : (row?.secret ?? null);
    await tx.query(
      `INSERT INTO sandbox_settings(id,config,secret,revision) VALUES (1,$1::jsonb,$2::jsonb,$3)
      ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,secret=EXCLUDED.secret,revision=EXCLUDED.revision,updated_at=now()`,
      [JSON.stringify(input.fields), JSON.stringify(secret), previous.revision + 1],
    );
  });
  return sandboxSettingsView();
}
