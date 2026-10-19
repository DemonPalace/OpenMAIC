/** Real PG + local Python execution. Model decisions are driven explicitly through the role tools. No cloud or live model calls. */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { PgAgentSessionStore, ensureAgentSessionSchema } from '@openmaic/storage/agent-session/pg';
vi.mock('server-only', () => ({}));
const mocked = vi.hoisted(() => ({
  pool: undefined as unknown,
  agents: undefined as unknown,
  root: '',
  responses: [] as Array<Array<Record<string, unknown>>>,
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: mocked.pool,
    withTransaction: async (fn: (db: unknown) => Promise<unknown>) => {
      const db = await (mocked.pool as Pool).connect();
      try {
        await db.query('BEGIN');
        const result = await fn(db);
        await db.query('COMMIT');
        return result;
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      } finally {
        db.release();
      }
    },
  }),
}));
vi.mock('@/lib/server/agent-runtime/store', () => ({
  getAgentSessionStore: async () => mocked.agents,
}));
vi.mock('@/lib/server/model-config/runtime', () => ({
  assertWorkspaceModelsAuthorized: async () => {},
  backgroundWorkspaceId: async (owner: string) => owner,
}));
vi.mock('@/lib/server/sandbox/settings', () => ({
  assertSandboxSettingsRevision: async () => {},
  resolvedSandboxConfig: async () => ({
    fingerprint: 'test',
    settingsRevision: 0,
    lifetimeMs: 300000,
    maxActive: 20,
    maxActivePerOwner: 10,
  }),
}));
vi.mock('@/lib/server/sandbox/providers/e2b-compatible', () => ({
  E2BCompatibleSandboxProvider: class {
    async create(id: string) {
      await mkdir(join(mocked.root, id), { recursive: true });
      return { id, state: 'running' };
    }
    async find() {
      return null;
    }
    async inspect(id: string) {
      return { id, state: 'running' };
    }
    async initializeWorkspace() {}
    async readText(id: string, _operation: string, path: string) {
      return readFile(join(mocked.root, id, basename(path)), 'utf8');
    }
    async writeText(id: string, _operation: string, path: string, text: string) {
      await writeFile(join(mocked.root, id, basename(path)), text);
    }
    async listWorkspace(id: string) {
      return (await readdir(join(mocked.root, id)))
        .filter((p) => !p.startsWith('.command-') && p !== '__pycache__')
        .map((path) => ({ path, kind: 'file', size: 0 }));
    }
    async startCommand(id: string, _operation: string, input: { id: string; command: string }) {
      let stdout = '',
        stderr = '',
        exitCode = 0;
      try {
        const result = await promisify(execFile)('/bin/sh', ['-c', input.command], {
          cwd: join(mocked.root, id),
          timeout: 10000,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (e) {
        const error = e as { stdout?: string; stderr?: string; code?: number };
        stdout = error.stdout ?? '';
        stderr = error.stderr ?? '';
        exitCode = typeof error.code === 'number' ? error.code : 1;
      }
      await writeFile(
        join(mocked.root, id, `.command-${input.id}`),
        JSON.stringify({
          id: input.id,
          state: 'exited',
          stdout,
          stderr,
          exitCode,
          truncated: false,
        }),
      );
    }
    async readCommand(id: string, _operation: string, commandId: string) {
      return JSON.parse(await readFile(join(mocked.root, id, `.command-${commandId}`), 'utf8'));
    }
  },
}));
vi.mock('@/lib/server/agent-runtime/agent-driver-model', () => ({
  resolveAgentDriverModel: async () => ({
    connection: { model: {} },
    piModel: { api: 'openai-completions', provider: 'openai', id: 'test-model' },
    wireMaxOutputTokens: undefined,
    reservedOutputTokens: 8192,
  }),
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getBackgroundDocumentStore: async () => ({}),
}));
vi.mock('@/lib/server/agent-runtime/event-notify-bus', () => ({
  notifyDurableAgentEvent: async () => {},
  subscribeAgentEventWakeup: () => () => {},
}));
vi.mock('@/lib/ai/llm', () => ({
  streamLLM: () => ({
    fullStream: (async function* () {
      for (const part of mocked.responses.shift() ?? []) yield part;
    })(),
    usage: new Promise(() => {}),
  }),
}));
import { runSession, startAgentRunner } from '@/lib/server/agent-runtime/runner';
import { ensureOwnerMergeSchema } from '@/lib/persistence/owner-merges';
import { ensureSandboxEnvironmentSchema } from '@/lib/persistence/sandbox-environments';
import { installedProject } from '@/lib/server/pbl-v3/catalog';
import { LearningStore } from '@/lib/server/pbl-v3/store';
import { commandStudy, learningView, digest } from '@/lib/server/pbl-v3/runtime';
import { teachingRunnerConfig } from '@/lib/server/pbl-v3/runner-tools';
import { startOrchestration } from '@/lib/pbl/v3/domain/orchestration/transition';
import { SandboxService } from '@/lib/server/sandbox/service';
import type { OwnerPrincipal } from '@/lib/server/identity/types';

const url = process.env.PG_CONTRACT_URL,
  schema = `pbl_v3_${randomUUID().replaceAll('-', '')}`;
let admin: Pool, pool: Pool, store: LearningStore, agents: PgAgentSessionStore;
const principal: OwnerPrincipal = {
  ownerId: 'learner-a',
  kind: 'user',
  assurance: 'verified',
  roles: new Set(['sandbox:use']),
};
const project = installedProject({ id: 'greeting-python', version: '1.0.0' });
let studyId: string;
async function command(type: string, payload: Record<string, unknown> = {}) {
  const row = await store.get(studyId, principal.ownerId);
  return commandStudy(principal, studyId, {
    id: randomUUID(),
    revision: row.revision,
    type,
    ...payload,
  });
}
async function runTools(
  instruction: string,
  steps: (config: Awaited<ReturnType<typeof teachingRunnerConfig>>) => Promise<void>,
) {
  const queued = (await command('chat', { text: instruction })) as { sessionId: string };
  const meta = await agents.claimNextSession('test-worker', process.pid, {
    sessionId: queued.sessionId,
    leaseTtlMs: 10000,
    maxAttempts: 5,
  });
  expect(meta).toBeTruthy();
  const config = await teachingRunnerConfig({
    sessionId: queued.sessionId,
    ownerId: principal.ownerId,
    workerId: 'test-worker',
    attempt: meta!.attempt,
    signal: new AbortController().signal,
  });
  expect(config.allowedToolNames.has('patch_stage')).toBe(false);
  await steps(config);
  await agents.finishSession(queued.sessionId, 'test-worker', {
    status: 'succeeded',
    expectedAttempt: meta!.attempt,
  });
}
async function invoke(
  config: Awaited<ReturnType<typeof teachingRunnerConfig>>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = config.tools.find((t) => t.name === name)!;
  expect(tool).toBeDefined();
  return tool.execute(randomUUID(), args);
}
async function guided(role: 'teaching' | 'plan' | 'code') {
  const parts = role === 'teaching' ? 3 : 4;
  for (let index = 0; index < parts; index++)
    await runTools(
      index === 0 ? 'Please start.' : 'I checked the current part and understand it.',
      async (config) => {
        await invoke(config, 'read_next_skill', {
          ...(index ? { studentFeedback: 'I checked the current part' } : {}),
        });
        if (index === 0 && role !== 'teaching') {
          const path = role === 'plan' ? 'PLAN.md' : 'greeting.py';
          const service = await SandboxService.forOwner(principal),
            row = await store.get(studyId, principal.ownerId);
          const text = await service.readText(row.environment_id!, path);
          await invoke(config, 'write_file', {
            path,
            text:
              role === 'plan'
                ? 'Use a formatted string to return the greeting.'
                : 'def greet(name):\n    return f"Hello, {name}!"\n',
            expectedHash: digest(text),
          });
        }
        await invoke(config, 'request_skill_review', {
          question: 'Explain and check the current part.',
        });
      },
    );
  await runTools('I checked the current part and confirm it.', async (config) => {
    await invoke(config, 'complete_stage', { studentFeedback: 'I checked the current part' });
  });
  if (!(await store.get(studyId, principal.ownerId)).state.introCompleted) {
    // Generic Agent APIs must not make an old completion valid for a new student message.
    const binding = (await store.roles(studyId)).find((binding) => binding.role === 'mentor')!;
    await agents.postUserMessage(
      binding.session_id,
      { text: 'I still have a question.' },
      { expectedOwnerId: principal.ownerId },
    );
    const meta = await agents.claimNextSession('direct-worker', process.pid, {
      sessionId: binding.session_id,
      leaseTtlMs: 10000,
      maxAttempts: 5,
    });
    await agents.finishSession(binding.session_id, 'direct-worker', {
      status: 'succeeded',
      expectedAttempt: meta!.attempt,
    });
    expect((await learningView(principal, studyId)).actions).not.toContain('next');
    await expect(command('next')).rejects.toThrow('teaching interaction');
    await runTools('I checked the current part and confirm it.', async (config) => {
      await invoke(config, 'complete_stage', { studentFeedback: 'I checked the current part' });
    });
  }
  await command('next');
}
describe.skipIf(!url)('PBL v3 teaching runtime with real PG', () => {
  beforeAll(async () => {
    mocked.root = await mkdtemp(join(tmpdir(), 'pbl-v3-test-'));
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 });
    mocked.pool = pool;
    await ensureOwnerMergeSchema(pool);
    await ensureSandboxEnvironmentSchema(pool);
    await ensureAgentSessionSchema(pool);
    agents = new PgAgentSessionStore(pool, {
      withTransaction: async (fn) => {
        const db = await pool.connect();
        try {
          await db.query('BEGIN');
          const result = await fn(db);
          await db.query('COMMIT');
          return result;
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        } finally {
          db.release();
        }
      },
    });
    mocked.agents = agents;
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('OPENMAIC_AGENT_RUNTIME_ENABLED', 'true');
    store = await LearningStore.open();
    studyId = (
      await store.create(
        {
          ownerId: principal.ownerId,
          stageId: 'classroom',
          sceneId: 'scene',
          projectId: project.ref.id,
          version: project.ref.version,
        },
        startOrchestration(project.definition),
      )
    ).id;
  }, 30000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
    if (mocked.root) await rm(mocked.root, { recursive: true, force: true });
  });
  it('pins project identity and isolates learners', async () => {
    const same = await store.create(
      {
        ownerId: principal.ownerId,
        stageId: 'classroom',
        sceneId: 'scene',
        projectId: project.ref.id,
        version: project.ref.version,
      },
      startOrchestration(project.definition),
    );
    expect(same.id).toBe(studyId);
    await expect(store.get(studyId, 'learner-b')).rejects.toMatchObject({ status: 404 });
    await expect(
      commandStudy({ ...principal, ownerId: 'learner-b' }, studyId, {
        id: randomUUID(),
        revision: 0,
        type: 'next',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects student advancement before teaching, and gates new feedback', async () => {
    await command('prepare');
    await expect(command('next')).rejects.toThrow('teaching interaction');
    await runTools('Please start.', async (config) => {
      await expect(
        invoke(config, 'complete_stage', { studentFeedback: 'Please start.' }),
      ).rejects.toThrow();
    });
  });
  it('retries a chat receipt without duplicating a student turn', async () => {
    const before = await store.get(studyId, principal.ownerId);
    const input = {
      id: randomUUID(),
      revision: before.revision,
      type: 'chat',
      text: 'Please start.',
    };
    const first = (await commandStudy(principal, studyId, input)) as { sessionId: string };
    const after = await store.get(studyId, principal.ownerId);
    const binding = await store.binding(first.sessionId);
    expect(await commandStudy(principal, studyId, input)).toEqual(first);
    expect((await store.get(studyId, principal.ownerId)).revision).toBe(after.revision);
    expect((await store.binding(first.sessionId))?.feedback_seq).toBe(binding?.feedback_seq);
    await expect(
      commandStudy(principal, studyId, { ...input, text: 'Different request' }),
    ).rejects.toThrow('different operation');
    const meta = await agents.claimNextSession('receipt-worker', process.pid, {
      sessionId: first.sessionId,
      leaseTtlMs: 10000,
      maxAttempts: 5,
    });
    const abort = new AbortController();
    const config = await teachingRunnerConfig({
      sessionId: first.sessionId,
      ownerId: principal.ownerId,
      workerId: 'receipt-worker',
      attempt: meta!.attempt,
      signal: abort.signal,
    });
    abort.abort();
    await expect(invoke(config, 'read_next_skill')).rejects.toThrow('cancelled');
    await agents.finishSession(first.sessionId, 'receipt-worker', {
      status: 'succeeded',
      expectedAttempt: meta!.attempt,
    });
  });
  it('prepares once and runs the complete learning flow with actual Python tests', async () => {
    await command('prepare');
    await guided('teaching'); // project intro
    await guided('teaching'); // concepts
    await runTools('I prefer formatted strings.', async () => {});
    await command('decide', { decisionId: 'format', chosen: 'format' });
    await command('next');
    await guided('plan');
    await guided('code');
    const service = await SandboxService.forOwner(principal);
    const environmentId = (await store.get(studyId, principal.ownerId)).environment_id!;
    const code = await service.readText(environmentId, 'greeting.py');
    await service.compareAndWriteText(
      environmentId,
      'greeting.py',
      'def greet(name):\n    return "wrong"\n',
      digest(code),
    );
    await command('evaluate');
    await command('collect');
    await expect(command('next')).rejects.toThrow('not available');
    await runTools('Please help me fix the failed greeting test.', async (config) => {
      expect(config.systemPrompt).toContain('observed test failure');
      const current = await service.readText(environmentId, 'greeting.py');
      await expect(
        invoke(config, 'write_file', {
          path: 'PLAN.md',
          text: 'overwrite',
          expectedHash: digest(''),
        }),
      ).rejects.toThrow('cannot write');
      await invoke(config, 'write_file', {
        path: 'greeting.py',
        text: code,
        expectedHash: digest(current),
      });
    });
    const evaluation = (await command('evaluate')) as { exitCode: number };
    expect(evaluation.exitCode).toBe(0);
    await command('collect');
    const tested = await store.get(studyId, principal.ownerId);
    expect(tested.state.collected.greeting!.tests?.status).toBe('passed');
    expect(tested.state.collected.greeting!.tests?.publicFeedback).toContain('2 checks passed');
    await command('next');
    await command('quiz', { answers: [0] });
    await command('next');
    await guided('teaching');
    const restored = await new LearningStore(pool).get(studyId, principal.ownerId);
    expect(restored.state.status).toBe('completed');
    expect((await learningView(principal, studyId)).actions).toEqual([]);
    expect(
      (await pool.query('SELECT count(*) FROM pbl_v3_events WHERE study_id=$1', [studyId])).rows[0]
        .count,
    ).toBe(String(restored.state.lastSequence));
  }, 60000);
  it('executes teaching tools through the existing runner and Pi loop, then reconnects from durable history', async () => {
    const original = studyId;
    studyId = (
      await store.create(
        {
          ownerId: principal.ownerId,
          stageId: 'runner-classroom',
          sceneId: 'runner-scene',
          projectId: project.ref.id,
          version: project.ref.version,
        },
        startOrchestration(project.definition),
      )
    ).id;
    await command('prepare');
    const handle = startAgentRunner();
    await handle.stop();
    const queued = (await command('chat', { text: 'Please teach me about this project.' })) as {
      sessionId: string;
    };
    const meta = await agents.claimNextSession(handle.workerId, process.pid, {
      sessionId: queued.sessionId,
      leaseTtlMs: 10000,
      maxAttempts: 5,
    });
    const finish = {
      type: 'finish',
      finishReason: 'tool-calls',
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { reasoningTokens: 0 },
        totalTokens: 2,
      },
    };
    mocked.responses = [
      [
        { type: 'tool-call', toolCallId: 'read-section', toolName: 'read_next_skill', input: {} },
        finish,
      ],
      [
        {
          type: 'tool-call',
          toolCallId: 'ask-review',
          toolName: 'request_skill_review',
          input: { question: 'What should greet(name) return?' },
        },
        finish,
      ],
    ];
    await runSession({ running: new Map(), shuttingDown: false }, meta!);
    const settled = await agents.getSession(queued.sessionId);
    expect(settled?.status, settled?.error).toBe('succeeded');
    const restored = await learningView(principal, studyId);
    expect(restored.messages.some((m) => m.text === 'What should greet(name) return?')).toBe(true);
    expect(restored.actions).not.toContain('next');
    expect((await store.binding(queued.sessionId))?.guided?.pending?.question).toBe(
      'What should greet(name) return?',
    );
    studyId = original;
  }, 30000);
  it('rejects stale file writes without overwriting the new content', async () => {
    const row = await store.get(studyId, principal.ownerId),
      service = await SandboxService.forOwner(principal);
    const first = await service.readText(row.environment_id!, 'greeting.py');
    await service.compareAndWriteText(
      row.environment_id!,
      'greeting.py',
      'new content',
      digest(first),
    );
    await expect(
      service.compareAndWriteText(
        row.environment_id!,
        'greeting.py',
        'stale overwrite',
        digest(first),
      ),
    ).rejects.toThrow('changed');
    expect(await service.readText(row.environment_id!, 'greeting.py')).toBe('new content');
  });
  it('fences a stale role after progression', async () => {
    const roles = await store.roles(studyId),
      old = roles.find((r) => r.role === 'planner')!;
    await expect(
      teachingRunnerConfig({
        sessionId: old.session_id,
        ownerId: principal.ownerId,
        workerId: 'old',
        attempt: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('changed');
  });
});
