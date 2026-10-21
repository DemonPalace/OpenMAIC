import type { AgentConfig } from '@/lib/orchestration/registry/types';
import { advertisedVoices } from '@/lib/server/generation/run/narration-voice';
import { expect, it } from 'vitest';
import { parseModelConfig } from '@/lib/server/model-config/openmaic-yml';
import { resolveSlot } from '@/lib/server/model-config/resolve-slot';
import { slotTTSProvidersConfig } from '@/lib/audio/tts-selection';
import { getEnabledProvidersWithVoices, resolveAgentVoice } from '@/lib/audio/voice-resolver';

const voices = [
  { id: 'vivian', name: 'Vivian' },
  { id: 'serena', name: 'Serena' },
];
const config = (list?: unknown) => ({
  providers: {
    cogevol: {
      preset: 'openai-tts',
      models: ['qwen3-tts'],
      ...(list === undefined ? {} : { voices: list }),
    },
  },
  slots: { tts: 'cogevol:qwen3-tts' },
});
it('passes provider-local voices through YAML, slot resolution and the browser map', () => {
  const parsed = parseModelConfig(JSON.stringify(config(voices)));
  const target = resolveSlot('tts', [{ source: 'deployment', config: parsed }]);
  expect(target.status).toBe('assigned');
  if (target.status !== 'assigned') throw new Error('unassigned');
  const map = slotTTSProvidersConfig(target);
  expect(getEnabledProvidersWithVoices(map)[0].voices.map((v) => v.id)).toEqual([
    'vivian',
    'serena',
  ]);
  expect(getEnabledProvidersWithVoices(map)[0].modelGroups[0].modelId).toBe('qwen3-tts');
});
it('preserves built-in voices when the provider has no list', () => {
  const groups = getEnabledProvidersWithVoices({
    'openai-tts': { enabled: true, isServerConfigured: true, modelId: 'tts-1' },
  });
  expect(groups[0].voices.map((v) => v.id)).toContain('alloy');
  expect(groups[0].voices.map((v) => v.id)).not.toContain('vivian');
});
it.each(
  [
    [],
    [{ id: '', name: 'Empty' }],
    [{ id: 'vivian' }],
    [{ id: 'vivian', name: 'Vivian', secret: 'x' }],
    [voices[0], voices[0]],
  ].map((list) => ({ list })),
)('rejects malformed or duplicate lists: %j', ({ list }) => {
  expect(() => parseModelConfig(JSON.stringify(config(list)))).toThrow();
});

it('preserves configured voice metadata in the generated agent catalogue', () => {
  const result = advertisedVoices({
    providerId: 'openai-tts',
    modelId: 'qwen3-tts',
    connection: {
      providerId: 'openai-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration',
      voices: [{ id: 'vivian', name: 'Vivian', gender: 'female', language: 'zh-CN' }],
    },
  });
  expect(result).toEqual([
    expect.objectContaining({ voiceId: 'vivian', gender: 'female', voiceLanguage: 'zh-CN' }),
  ]);
});

it('retains an explicit legacy voice binding without adding it to the picker', () => {
  const groups = getEnabledProvidersWithVoices({
    'openai-tts': { enabled: true, isServerConfigured: true, modelId: 'qwen3-tts', voices },
  });
  const agent = {
    id: 'teacher',
    voiceConfig: { providerId: 'openai-tts', modelId: 'qwen3-tts', voiceId: 'alloy' },
  } as AgentConfig;
  expect(resolveAgentVoice(agent, 0, groups)?.voiceId).toBe('alloy');
  expect(groups[0].voices.map((v) => v.id)).not.toContain('alloy');
});

it('honors configured catalogue membership over conflicting built-in model metadata', () => {
  const groups = getEnabledProvidersWithVoices({
    'openai-tts': {
      enabled: true,
      isServerConfigured: true,
      modelId: 'custom-tts',
      voices: [...voices, { id: 'marin', name: 'Custom Marin' }],
    },
  });
  const agent = {
    id: 'teacher',
    voiceConfig: { providerId: 'openai-tts', voiceId: 'marin' },
  } as AgentConfig;
  expect(resolveAgentVoice(agent, 0, groups)?.voiceId).toBe('marin');
});

it('retains a configured restricted id through user selection and generated narration', async () => {
  const { ttsSelection } = await import('@/lib/audio/tts-selection');
  const { clipVoice, slotVoice, narratorVoiceForGeneration } =
    await import('@/lib/server/generation/run/narration-voice');
  const parsed = parseModelConfig(
    JSON.stringify(config([...voices, { id: 'marin', name: 'Custom Marin' }])),
  );
  const effective = resolveSlot('tts', [{ source: 'deployment', config: parsed }]);
  if (effective.status !== 'assigned') throw new Error('unassigned');
  const capabilities = {
    known: true,
    tts: effective,
    llm: null,
    asr: null,
    image: null,
    video: null,
    webSearch: null,
    webFetch: null,
    document: null,
    resolved: new Set(['tts'] as const),
  };
  expect(
    ttsSelection(capabilities, { voice: 'marin', providerId: 'openai-tts', speed: 1 })?.voice,
  ).toBe('marin');
  const target = {
    providerId: 'openai-tts' as const,
    modelId: 'qwen3-tts',
    connection: {
      providerId: 'openai-tts',
      modelId: 'qwen3-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration' as const,
      options: { defaultVoice: 'vivian' },
      voices: [...voices, { id: 'marin', name: 'Custom Marin' }],
    },
  };
  expect(slotVoice(target, { providerId: 'openai-tts', voiceId: 'marin' }).voice).toBe('marin');
  expect(
    narratorVoiceForGeneration(target, { providerId: 'openai-tts', voiceId: 'marin' })?.voiceId,
  ).toBe('marin');
  expect(
    clipVoice({
      target,
      preference: undefined,
      bound: { providerId: 'openai-tts', voiceId: 'marin' },
      unavailable: new Set(),
    })?.voice.voiceId,
  ).toBe('marin');
});

it('does not inherit built-in gender when a replacement catalogue omits it', () => {
  const result = advertisedVoices({
    providerId: 'openai-tts',
    modelId: 'custom-tts',
    connection: {
      providerId: 'openai-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration',
      voices: [{ id: 'onyx', name: 'Custom Onyx' }],
    },
  });
  expect(result[0]).not.toHaveProperty('gender');
});

it('uses the first configured voice when no separate default is provided', async () => {
  const { defaultVoiceFor } = await import('@/lib/audio/tts-selection');
  const { configuredDefaultVoice } = await import('@/lib/audio/provider-default-voice');
  const { slotVoice } = await import('@/lib/server/generation/run/narration-voice');
  expect(defaultVoiceFor('openai-tts', 'custom-tts', undefined, voices)).toBe('vivian');
  expect(configuredDefaultVoice(undefined, voices)).toBe('vivian');
  const target = {
    providerId: 'openai-tts' as const,
    modelId: 'custom-tts',
    connection: {
      providerId: 'openai-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration' as const,
      voices,
    },
  };
  expect(slotVoice(target, undefined).voice).toBe('vivian');
  expect(defaultVoiceFor('openai-tts', 'custom-tts', { defaultVoice: 'serena' }, voices)).toBe(
    'serena',
  );
  expect(defaultVoiceFor('openai-tts', 'custom-tts')).toBe('alloy');
});

it('keeps configured Qwen catalogue voices on the ordinary model through selection', async () => {
  const { isQwenCloneVoice, resolveTTSModelForVoice } = await import('@/lib/audio/constants');
  const { slotTTSModel } = await import('@/lib/server/provider-config');
  const { clipVoice, advertisedVoices } =
    await import('@/lib/server/generation/run/narration-voice');
  const catalog = [{ id: 'vivian', name: 'Vivian' }];
  expect(isQwenCloneVoice('vivian', catalog)).toBe(false);
  expect(isQwenCloneVoice('unlisted-clone', catalog)).toBe(true);
  expect(isQwenCloneVoice('vivian')).toBe(true);
  expect(resolveTTSModelForVoice('qwen-tts', 'vivian', 'qwen3-tts', catalog)).toBe('qwen3-tts');
  expect(slotTTSModel('qwen-tts', 'qwen3-tts', 'vivian', catalog)).toBe('qwen3-tts');
  const target = {
    providerId: 'qwen-tts' as const,
    modelId: 'qwen3-tts',
    connection: {
      providerId: 'qwen-tts',
      modelId: 'qwen3-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration' as const,
      voices: catalog,
    },
  };
  expect(advertisedVoices(target)[0].modelId).toBeUndefined();
  expect(
    clipVoice({
      target,
      preference: undefined,
      bound: { providerId: 'qwen-tts', voiceId: 'vivian' },
      unavailable: new Set(),
    })?.voice.modelId,
  ).toBe('qwen3-tts');
  const groups = getEnabledProvidersWithVoices({
    'qwen-tts': { enabled: true, isServerConfigured: true, modelId: 'qwen3-tts', voices: catalog },
  });
  expect(resolveAgentVoice({ id: 'teacher' } as AgentConfig, 0, groups)?.voiceId).toBe('vivian');
});

it('recovers stale VC model bindings to the configured ordinary Qwen model', async () => {
  const { resolveNarratorVoiceBinding } = await import('@/lib/audio/voice-resolver');
  const catalog = [{ id: 'vivian', name: 'Vivian' }];
  const config = { enabled: true, isServerConfigured: true, modelId: 'qwen3-tts', voices: catalog };
  const bound = {
    providerId: 'qwen-tts' as const,
    voiceId: 'vivian',
    modelId: 'qwen3-tts-vc-2026-01-22',
  };
  const global = { providerId: 'qwen-tts' as const, voiceId: 'vivian', modelId: 'qwen3-tts' };
  expect(resolveNarratorVoiceBinding(bound, global, { 'qwen-tts': config }).modelId).toBe(
    'qwen3-tts',
  );
  expect(
    resolveAgentVoice(
      { id: 'teacher', voiceConfig: bound } as AgentConfig,
      0,
      getEnabledProvidersWithVoices({ 'qwen-tts': config }),
    )?.modelId,
  ).toBe('qwen3-tts');
});

it('drops stale global preferences outside a replacement catalogue but retains course bindings', async () => {
  const { ttsSelection } = await import('@/lib/audio/tts-selection');
  const { slotVoice, clipVoice } = await import('@/lib/server/generation/run/narration-voice');
  const parsed = parseModelConfig(JSON.stringify(config(voices)));
  const effective = resolveSlot('tts', [{ source: 'deployment', config: parsed }]);
  if (effective.status !== 'assigned') throw new Error('unassigned');
  const capabilities = {
    known: true,
    tts: effective,
    llm: null,
    asr: null,
    image: null,
    video: null,
    webSearch: null,
    webFetch: null,
    document: null,
    resolved: new Set(['tts'] as const),
  };
  expect(
    ttsSelection(capabilities, { voice: 'alloy', providerId: 'openai-tts', speed: 1 })?.voice,
  ).toBe('vivian');
  const target = {
    providerId: 'openai-tts' as const,
    modelId: 'qwen3-tts',
    connection: {
      providerId: 'openai-tts',
      modelId: 'qwen3-tts',
      managed: true,
      userEndpoint: false,
      origin: 'configuration' as const,
      voices,
    },
  };
  expect(slotVoice(target, { providerId: 'openai-tts', voiceId: 'alloy' }).voice).toBe('vivian');
  expect(slotVoice(target, { providerId: 'openai-tts', voiceId: 'serena' }).voice).toBe('serena');
  expect(
    clipVoice({
      target,
      preference: undefined,
      bound: { providerId: 'openai-tts', voiceId: 'alloy' },
      unavailable: new Set(),
    })?.voice.voiceId,
  ).toBe('alloy');
});
