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
