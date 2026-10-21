/** Optional provider-local default; absent or invalid values preserve legacy behavior. */
export function configuredDefaultVoice(options?: Record<string, unknown>): string | undefined {
  const voice = options?.defaultVoice;
  return typeof voice === 'string' && voice.trim() ? voice.trim() : undefined;
}
