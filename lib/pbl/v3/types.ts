import type { PblSessionState } from './domain/orchestration/types';
import type { AgentRole, StageDefinition } from './domain/project/project-schema';

/** A scene selects a server-installed, immutable project; it never carries teaching state. */
export interface PBLV3Reference {
  id: string;
  version: string;
}
export function isPBLV3Reference(value: unknown): value is PBLV3Reference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.id === 'string' &&
    /^[a-z0-9-]{1,80}$/.test(ref.id) &&
    typeof ref.version === 'string' &&
    /^[a-zA-Z0-9.-]{1,40}$/.test(ref.version)
  );
}
export interface LearningView {
  id: string;
  revision: number;
  title: string;
  environmentId: string | null;
  environment: { state: import('@/lib/sandbox/types').SandboxState; ready: boolean } | null;
  recovery: { checkpointRevision: number; progressReset: boolean } | null;
  state: PblSessionState;
  stage: StageDefinition;
  milestones?: { id: string; title: string; optional: boolean; stages: string[] }[];
  role: AgentRole | null;
  actions: string[];
  files: string[];
  busy: boolean;
  messages: { role: 'user' | 'assistant'; text: string }[];
  roleRun: {
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'missing';
    failure: 'authentication' | 'timeout' | 'unavailable' | null;
    canRetry: boolean;
  } | null;
  decisions: { id: string; prompt: string; options: { id: string; label: string }[] }[];
  questions: { q: string; options: string[] }[];
  evaluation: { id: string; state: string; stdout: string; stderr: string } | null;
}
