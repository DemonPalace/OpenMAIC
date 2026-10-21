import type { AgentRole } from './domain/project/project-schema';

/** Deliberately excludes raw tool payloads, prompts, reasoning and provider errors. */
export interface LearningConversationEntry {
  id: string;
  at?: number;
  speaker: 'user' | AgentRole;
  parts: (
    | { kind: 'text'; id: string; text: string; streaming?: boolean }
    | {
        kind: 'tool';
        id: string;
        action: 'read' | 'write' | 'build' | 'collect' | 'review' | 'complete';
        status: 'running' | 'succeeded' | 'failed' | 'interrupted';
      }
  )[];
}
