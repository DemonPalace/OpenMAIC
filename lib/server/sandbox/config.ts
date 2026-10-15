import 'server-only';

import { createHash } from 'node:crypto';

import { SandboxError } from '@/lib/sandbox/errors';

export interface SandboxConfig {
  /** Persisted settings revision; zero means deployment environment. */
  settingsRevision?: number;
  connectionId: string;
  fingerprint: string;
  apiKey: string;
  domain: string;
  apiUrl: string;
  template: string;
  desktopTemplate?: string;
  lifetimeMs: number;
  maxActivePerOwner: number;
  maxActive: number;
}

const invalid = () =>
  new SandboxError('SANDBOX_CONFIG_INVALID', 503, 'Sandbox deployment configuration is invalid.');

type Env = Readonly<Record<string, string | undefined>>;
function required(name: string, env: Env): string {
  const value = env[name]?.trim();
  if (!value) throw invalid();
  return value;
}

function integer(name: string, fallback: number, min: number, max: number, env: Env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw invalid();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid();
  return value;
}

/** Separate from model providers. Unconfigured installations never load a cloud SDK. */
export function sandboxConfig(env: Env = process.env): SandboxConfig {
  if (!env.OPENMAIC_SANDBOX_PROVIDER?.trim()) {
    throw new SandboxError('SANDBOX_DISABLED', 503, 'Sandbox provider is not configured.');
  }
  if (env.OPENMAIC_SANDBOX_PROVIDER !== 'e2b-compatible') throw invalid();
  const connectionId = required('OPENMAIC_SANDBOX_CONNECTION_ID', env);
  const domain = env.OPENMAIC_SANDBOX_DOMAIN?.trim() || 'e2b.app';
  const endpoint =
    env.OPENMAIC_SANDBOX_API_URL?.trim() ||
    (domain === 'e2b.app' ? 'https://api.e2b.dev' : required('OPENMAIC_SANDBOX_API_URL', env));
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw invalid();
  const apiUrl = url.origin;
  const template = required('OPENMAIC_SANDBOX_TEMPLATE', env);
  const desktopTemplate = env.OPENMAIC_SANDBOX_DESKTOP_TEMPLATE?.trim() || undefined;
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(connectionId)) throw invalid();
  // Endpoints come only from deployment settings or the authorized installation administrator.
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain)
  )
    throw invalid();
  if (template.length > 256 || /[\s\x00-\x1f]/.test(template)) throw invalid();
  if (desktopTemplate && (desktopTemplate.length > 256 || /[\s\x00-\x1f]/.test(desktopTemplate)))
    throw invalid();
  // These legacy SDK globals can redirect data-plane traffic away from the configured domain.
  if (env.E2B_SANDBOX_URL || env.E2B_ACCESS_TOKEN) throw invalid();
  return {
    connectionId,
    fingerprint: createHash('sha256')
      .update(JSON.stringify([connectionId, apiUrl, domain, template, desktopTemplate]))
      .digest('hex'),
    apiKey: required('OPENMAIC_SANDBOX_API_KEY', env),
    domain,
    apiUrl,
    template,
    desktopTemplate,
    lifetimeMs: integer('OPENMAIC_SANDBOX_LIFETIME_MS', 300_000, 60_000, 3_600_000, env),
    maxActivePerOwner: integer('OPENMAIC_SANDBOX_MAX_ACTIVE_PER_OWNER', 1, 1, 20, env),
    maxActive: integer('OPENMAIC_SANDBOX_MAX_ACTIVE', 5, 1, 100, env),
  };
}
