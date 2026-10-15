import { getClientTranslation } from '@/lib/i18n';
export class SandboxRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
export const sandboxBase = '/api/sandbox/environments';
export async function sandboxApi<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  return sandboxRequest(sandboxBase + path, method, body);
}
export async function sandboxRequest<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    headers: { 'X-OpenMAIC-Sandbox': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || !json.success)
    throw new SandboxRequestError(
      json.error?.message ?? getClientTranslation('sandbox.requestFailed'),
      response.status,
      json.error?.code,
    );
  return json.data;
}
