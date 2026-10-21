/**
 * Runner wiring of the default course skill (`defaultCourseSkill`).
 *
 * Drives `runSession` through a fake agent with REAL skills loaded from a temp
 * directory and durable messages served from a fake event log, so both entry
 * points are observable: the prompt path of an opening request, and the resume
 * repair of an opening turn cut off before its skill load completed. The
 * resume fixtures follow the runner's real write order — a user frame is
 * appended before its delivery mark, and a skill read after both.
 */
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { InMemorySessionRepo, Session } from '@earendil-works/pi-agent-core';
import type { ClaimedAgentSession } from '@openmaic/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Point the real skill loader at a temp directory BEFORE config.ts loads. */
const fixture = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports -- vi.hoisted runs before
     module imports, and OPENMAIC_AGENT_SKILLS_DIR must be set before config.ts loads. */
  const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = mkdtempSync(join(tmpdir(), 'default-course-skill-'));
  for (const [name, body] of [
    ['pro-editing', 'Edit an EXISTING course.'],
    ['stage-design', 'Design a stage.'],
  ] as const) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(
      join(root, name, 'SKILL.md'),
      `---\nname: ${name}\ntitle: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n\n${body}\n`,
      'utf8',
    );
  }
  process.env.OPENMAIC_AGENT_SKILLS_DIR = root;
  return { root };
});

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'runner-test-uuid'),
  getAgentSessionStore: vi.fn(),
  getServerPersistenceProvider: vi.fn(),
  openEntryStorage: vi.fn(),
  resolveAgentDriverModel: vi.fn(),
  createCallLlmStreamFn: vi.fn(),
  buildAgent: vi.fn(),
}));

vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return { ...actual, randomUUID: mocks.randomUUID };
});
vi.mock('@/lib/server/agent-runtime/store', () => ({
  getAgentSessionStore: mocks.getAgentSessionStore,
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: mocks.getServerPersistenceProvider,
}));
vi.mock('@/lib/server/agent-runtime/session-materials', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/server/agent-runtime/session-materials')>();
  return { ...actual, listSessionMaterials: vi.fn(async () => []) };
});
vi.mock('@/lib/server/agent-runtime/material-resolver', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/server/agent-runtime/material-resolver')>();
  return { ...actual, listSessionScopeMaterials: vi.fn(async () => []) };
});
vi.mock('@/lib/server/agent-runtime/entry-tree-storage', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/server/agent-runtime/entry-tree-storage')>();
  return { ...actual, AgentSessionEntryStorage: { open: mocks.openEntryStorage } };
});
// A named classroom is looked up in the owner's library; none exists here.
vi.mock('@/lib/server/agent-runtime/curriculum-tools', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/server/agent-runtime/curriculum-tools')>();
  return { ...actual, probeStageAccess: vi.fn(async () => ({ kind: 'missing' })) };
});
vi.mock('@/lib/server/agent-runtime/course-generation', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/server/agent-runtime/course-generation')>();
  return { ...actual, listCourseGenerations: vi.fn(async () => new Map()) };
});
vi.mock('@/lib/server/agent-runtime/agent-driver-model', () => ({
  resolveAgentDriverModel: mocks.resolveAgentDriverModel,
}));
vi.mock('@/lib/agent/runtime/stream-fn', () => ({
  createCallLlmStreamFn: mocks.createCallLlmStreamFn,
}));
vi.mock('@/lib/agent/runtime/build-agent', () => ({ buildAgent: mocks.buildAgent }));
vi.mock('@/lib/server/agent-runtime/user-skills', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/server/agent-runtime/user-skills')>();
  return { ...actual, listUserSkills: vi.fn(async () => []) };
});

import { runSession, tagDurableUserMessage } from '@/lib/server/agent-runtime/runner';
import { buildSkillPreload } from '@/lib/server/agent-runtime/skill-preload';
import { listSkills } from '@/lib/server/agent-runtime/skills';

const SESSION_ID = 'session-1';
/** Mirrors the runner's `WORKER_ID` derivation with the fixed mock uuid. */
const WORKER_ID = `runner-t:${process.pid}`;
const MODEL = { api: 'openai-completions', provider: 'openai', id: 'driver-model' };

interface LogEvent {
  id: number;
  ts: number;
  type: string;
  data?: Record<string, unknown>;
}

const userMessageEvent = (id: number, data: Record<string, unknown>): LogEvent => ({
  id,
  ts: id,
  type: 'user_message',
  data: { delivery: 'queued', materials: [], ...data },
});
const runFrame = (id: number, type = 'session_start'): LogEvent => ({ id, ts: id, type });

function makeMeta(overrides: Partial<ClaimedAgentSession> = {}): ClaimedAgentSession {
  return {
    id: SESSION_ID,
    ownerId: 'owner-1',
    prompt: 'Make a lesson on light refraction',
    // Every session carries a stage id: the store writes a placeholder when
    // the caller passes none. It says nothing about an attached course.
    stageId: 'stage-session-',
    existingCourse: false,
    status: 'running',
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    claimReason: 'queued',
    claimSeq: 0,
    deliveredUserMessageSeq: 0,
    ...overrides,
  };
}

function makeStore(meta: ClaimedAgentSession, log: LogEvent[]) {
  let seq = 1000;
  return {
    appendRunEvent: vi.fn(async () => {
      seq += 1;
      return seq;
    }),
    pruneMessageUpdates: vi.fn(async () => 0),
    clearCancel: vi.fn(async () => undefined),
    finishSession: vi.fn(async () => true),
    getSession: vi.fn(async () => ({ ...meta, lease: { workerId: WORKER_ID } })),
    readEventsAfter: vi.fn(async (_id: string, after: number, limit = 500) =>
      log.filter((event) => event.id > after).slice(0, limit),
    ),
    heartbeat: vi.fn(async () => true),
    getCancelRequestedAt: vi.fn(async () => null),
    isCancelRequested: vi.fn(async () => false),
    listUserMessages: vi.fn(async () => []),
    markUserMessageDelivered: vi.fn(async () => true),
    registerSessionUrls: vi.fn(async () => []),
    releaseLease: vi.fn(async () => undefined),
    requeueForRetry: vi.fn(async () => false),
    requeueSession: vi.fn(async () => false),
  };
}

interface Calls {
  prompts: unknown[];
  continues: number;
}

function makeFakeAgent(calls: Calls) {
  const listeners = new Set<(event: AgentEvent, signal?: AbortSignal) => void>();
  return {
    subscribe: (listener: (event: AgentEvent, signal?: AbortSignal) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt: async (input: unknown) => {
      calls.prompts.push(input);
    },
    continue: async () => {
      calls.continues += 1;
    },
    waitForIdle: async () => {},
    steer: () => {},
    abort: () => {},
    state: { messages: [] as AgentMessage[], errorMessage: undefined },
  };
}

const userFrame = (text: string, seq?: number): AgentMessage => {
  const message = {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1,
  } as AgentMessage;
  return seq === undefined ? message : tagDurableUserMessage(message, seq);
};

const assistantText = (text: string): AgentMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    ...MODEL,
    model: MODEL.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  }) as unknown as AgentMessage;

/** The real three-message load of stage-design, as the builder writes it. */
async function stageDesignLoad(): Promise<AgentMessage[]> {
  const skills = await listSkills();
  const load = await buildSkillPreload({
    text: 'x',
    skills,
    transcript: [],
    forced: [skills.find((skill) => skill.id === 'stage-design')!],
    model: MODEL,
  });
  return load.messages;
}

async function run(
  metaOverrides: Partial<ClaimedAgentSession>,
  options: {
    log?: LogEvent[];
    seed?: AgentMessage[];
    /** Builds the entry tree directly, for fixtures that need non-message entries. */
    build?: (session: Session) => Promise<void>;
  } = {},
) {
  const meta = makeMeta(metaOverrides);
  const repo = new InMemorySessionRepo();
  const session: Session = await repo.create({ id: SESSION_ID });
  for (const message of options.seed ?? []) await session.appendMessage(message);
  await options.build?.(session);
  const store = makeStore(meta, options.log ?? []);
  mocks.openEntryStorage.mockResolvedValue(session.getStorage());
  mocks.getAgentSessionStore.mockResolvedValue(store);
  const calls: Calls = { prompts: [], continues: 0 };
  mocks.buildAgent.mockImplementation(() => makeFakeAgent(calls));

  await runSession({ running: new Map(), shuttingDown: false }, meta);

  expect(store.finishSession).toHaveBeenCalledWith(
    SESSION_ID,
    WORKER_ID,
    expect.objectContaining({ status: 'succeeded' }),
  );
  return { calls, store };
}

type Frame = { role?: string; toolName?: string; details?: { skill?: string } };

/** Skill ids whose reads a prompt input carries, in order. */
function loadedSkills(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as Frame[])
    .filter((frame) => frame.role === 'toolResult' && frame.toolName === 'read')
    .map((frame) => frame.details?.skill ?? '');
}

function roles(input: unknown): string[] {
  return Array.isArray(input) ? (input as Frame[]).map((frame) => frame.role ?? '') : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAgentDriverModel.mockResolvedValue({
    connection: { model: undefined, thinkingConfig: undefined },
    piModel: MODEL,
    wireMaxOutputTokens: undefined,
    reservedOutputTokens: 8192,
  });
  mocks.createCallLlmStreamFn.mockReturnValue((() => {}) as never);
  mocks.getServerPersistenceProvider.mockResolvedValue({
    documentStore: { forOwner: () => ({}) },
  });
});

describe('default course skill on the prompt path', () => {
  it('S1: loads stage-design for a plain opening request with no message row', async () => {
    const { calls } = await run({});
    expect(calls.prompts).toHaveLength(1);
    expect(roles(calls.prompts[0])).toEqual(['user', 'assistant', 'toolResult']);
    expect(loadedSkills(calls.prompts[0])).toEqual(['stage-design']);
  });

  it('S2: loads stage-design when the opening message carries materials', async () => {
    const { calls } = await run(
      { prompt: 'Turn this handout into a class' },
      {
        log: [
          userMessageEvent(1, {
            text: 'Turn this handout into a class',
            materials: [{ id: 'material-1' }],
          }),
        ],
      },
    );
    expect(loadedSkills(calls.prompts[0])).toEqual(['stage-design']);
  });

  it('S3: leaves an opening message that names a course alone', async () => {
    const { calls } = await run(
      { prompt: 'Improve page 3' },
      {
        log: [
          userMessageEvent(1, {
            text: 'Improve page 3',
            courseRefs: [{ kind: 'course', stageId: 'stage-a', title: 'Optics' }],
          }),
        ],
      },
    );
    expect(loadedSkills(calls.prompts[0])).toEqual([]);
  });

  it('S3: leaves an opening message that names an element alone', async () => {
    const { calls } = await run(
      { prompt: 'Fix this' },
      {
        log: [
          userMessageEvent(1, {
            text: 'Fix this',
            elementRefs: [{ stageId: 'stage-a', sceneId: 'scene-1', elementId: 'el-1' }],
          }),
        ],
      },
    );
    expect(loadedSkills(calls.prompts[0])).toEqual([]);
  });

  it('keeps a typed handle as the only load', async () => {
    const { calls } = await run({ prompt: '/pro-editing make page three better' });
    expect(loadedSkills(calls.prompts[0])).toEqual(['pro-editing']);
  });

  it('keeps a frozen ?skill= selection as the only load', async () => {
    const { calls } = await run({ prompt: 'Make page three better', skillId: 'pro-editing' });
    expect(loadedSkills(calls.prompts[0])).toEqual(['pro-editing']);
  });

  it('does not attach the default to a session opened on an existing course', async () => {
    const { calls } = await run({ prompt: 'Make page three better', existingCourse: true });
    expect(calls.prompts).toEqual(['Make page three better']);
  });

  it('does not apply to a later message of the conversation', async () => {
    const { calls } = await run(
      { deliveredUserMessageSeq: 1 },
      {
        log: [
          userMessageEvent(1, { text: 'Hello' }),
          runFrame(2),
          userMessageEvent(5, { text: 'Now make a lesson on optics' }),
        ],
        seed: [userFrame('Hello', 1), assistantText('Hi!')],
      },
    );
    expect(calls.prompts).toHaveLength(1);
    expect(loadedSkills(calls.prompts[0])).toEqual([]);
  });
});

describe('default course skill on the resume path', () => {
  it.each([
    ['only the opening user frame', false],
    ['the opening user frame and a half-written read', true],
  ] as const)(
    'S4: no message row, %s landed — completes the load',
    async (_label, withReadCall) => {
      const [readCall] = await stageDesignLoad();
      const { calls, store } = await run(
        { claimReason: 'orphaned' },
        {
          log: [runFrame(1)],
          seed: [
            userFrame('Make a lesson on light refraction'),
            ...(withReadCall ? [readCall!] : []),
          ],
        },
      );
      expect(calls.continues).toBe(0);
      expect(calls.prompts).toHaveLength(1);
      // The repair carries no user frame. The fake agent emits no message_end,
      // so this pins the payload, not the persistence chain.
      expect(roles(calls.prompts[0])).toEqual(['assistant', 'toolResult']);
      expect(loadedSkills(calls.prompts[0])).toEqual(['stage-design']);
      expect(store.markUserMessageDelivered).not.toHaveBeenCalled();
    },
  );

  it('S5: the opening row exists, its delivery mark and the read never landed', async () => {
    // Real write order: the user frame is appended, the worker dies before
    // markUserMessageDelivered, so neither the read call nor its result exists.
    const { calls, store } = await run(
      { claimReason: 'orphaned', prompt: 'Turn this handout into a class' },
      {
        log: [
          userMessageEvent(1, {
            text: 'Turn this handout into a class',
            materials: [{ id: 'material-1' }],
          }),
          runFrame(2),
        ],
        seed: [userFrame('Turn this handout into a class', 1)],
      },
    );
    expect(calls.continues).toBe(0);
    expect(roles(calls.prompts[0])).toEqual(['assistant', 'toolResult']);
    expect(loadedSkills(calls.prompts[0])).toEqual(['stage-design']);
    expect(store.markUserMessageDelivered).not.toHaveBeenCalled();
  });

  it.each([
    ['a course', { courseRefs: [{ kind: 'course', stageId: 'stage-a', title: 'Optics' }] }],
    [
      'an element',
      { elementRefs: [{ stageId: 'stage-a', sceneId: 'scene-1', elementId: 'el-1' }] },
    ],
  ] as const)(
    'S5: the same prefix with an opening row naming %s stays unloaded',
    async (_label, refs) => {
      const { calls } = await run(
        { claimReason: 'orphaned', prompt: 'Improve page 3' },
        {
          log: [userMessageEvent(1, { text: 'Improve page 3', ...refs }), runFrame(2)],
          seed: [userFrame('Improve page 3', 1)],
        },
      );
      // The resumed text fell back to the session prompt; the row's reference still counts.
      expect(calls.prompts).toEqual([]);
      expect(calls.continues).toBe(1);
    },
  );

  it('S6: completes a half-written read after the opening row was marked delivered', async () => {
    const [readCall] = await stageDesignLoad();
    const { calls } = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 1, prompt: 'Teach me SQL joins' },
      {
        log: [userMessageEvent(1, { text: 'Teach me SQL joins' }), runFrame(2)],
        seed: [userFrame('Teach me SQL joins', 1), readCall!],
      },
    );
    expect(roles(calls.prompts[0])).toEqual(['assistant', 'toolResult']);
    expect(loadedSkills(calls.prompts[0])).toEqual(['stage-design']);
  });

  it('is idempotent: a completed load is not repeated on resume', async () => {
    const load = await stageDesignLoad();
    const { calls } = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 1, prompt: 'Teach me SQL joins' },
      {
        log: [userMessageEvent(1, { text: 'Teach me SQL joins' }), runFrame(2)],
        seed: [userFrame('Teach me SQL joins', 1), ...load],
      },
    );
    expect(calls.prompts).toEqual([]);
    expect(calls.continues).toBe(1);
  });

  it('S8: a consumed follow-up whose delivery mark lagged is read as the opening, and changes nothing', async () => {
    // Eligible opening, load already in the transcript: the dedupe makes it a no-op.
    const load = await stageDesignLoad();
    const eligible = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 1, prompt: 'Teach me SQL joins' },
      {
        log: [
          userMessageEvent(1, { text: 'Teach me SQL joins' }),
          runFrame(2),
          userMessageEvent(5, { text: 'Make it shorter' }),
        ],
        seed: [
          userFrame('Teach me SQL joins', 1),
          ...load,
          assistantText('Here is the plan.'),
          userFrame('Make it shorter', 5),
        ],
      },
    );
    expect(eligible.calls.prompts).toEqual([]);
    expect(eligible.calls.continues).toBe(1);

    // Ineligible opening (it named a course): the misread keeps it ineligible.
    const ineligible = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 1, prompt: 'Improve page 3' },
      {
        log: [
          userMessageEvent(1, {
            text: 'Improve page 3',
            courseRefs: [{ kind: 'course', stageId: 'stage-a', title: 'Optics' }],
          }),
          runFrame(2),
          userMessageEvent(5, { text: 'And page 4' }),
        ],
        seed: [userFrame('Improve page 3', 1), assistantText('Done.'), userFrame('And page 4', 5)],
      },
    );
    expect(ineligible.calls.prompts).toEqual([]);
    expect(ineligible.calls.continues).toBe(1);
  });

  /**
   * A compacted tree: the opening turn and its skill load are summarized away,
   * turn two is kept, turn three is the resumed tail. Built with pi's own
   * compaction entry, as the runner reads it.
   */
  async function compactedHistory(session: Session): Promise<void> {
    await session.appendMessage(userFrame('Teach me SQL joins', 1));
    for (const message of await stageDesignLoad()) await session.appendMessage(message);
    await session.appendMessage(assistantText('Course built.'));
    const keptId = await session.appendMessage(userFrame('Add a quiz', 5));
    await session.appendMessage(assistantText('Quiz added.'));
    await session.appendCompaction('Built a SQL joins course; added a quiz.', keptId, 50_000);
    await session.appendMessage(userFrame('Now shorten page 2', 9));
  }
  const compactedLog = [
    userMessageEvent(1, { text: 'Teach me SQL joins' }),
    runFrame(2),
    userMessageEvent(5, { text: 'Add a quiz' }),
    userMessageEvent(9, { text: 'Now shorten page 2' }),
  ];

  it('S9: a compacted history resumed at a later turn does not load, whatever the user frames left', async () => {
    const { calls } = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 9, prompt: 'Teach me SQL joins' },
      { log: compactedLog, build: compactedHistory },
    );
    expect(calls.prompts).toEqual([]);
    expect(calls.continues).toBe(1);
  });

  it('S10: with the opening read summarized away, a lagging cursor re-reads the opening and reloads', async () => {
    // The same rule every skill follows: the body is not in the context, so it
    // is supplied again. Documented in the plan; not a separate mechanism.
    const { calls } = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 1, prompt: 'Teach me SQL joins' },
      { log: compactedLog, build: compactedHistory },
    );
    expect(roles(calls.prompts[0])).toEqual(['assistant', 'toolResult']);
    expect(loadedSkills(calls.prompts[0])).toEqual(['stage-design']);
  });

  it('does not load on the resume of a delivered follow-up', async () => {
    const { calls } = await run(
      { claimReason: 'orphaned', deliveredUserMessageSeq: 5 },
      {
        log: [
          userMessageEvent(1, { text: 'Hello' }),
          runFrame(2),
          userMessageEvent(5, { text: 'Now make a lesson on optics' }),
        ],
        seed: [
          userFrame('Hello', 1),
          assistantText('Hi!'),
          userFrame('Now make a lesson on optics', 5),
        ],
      },
    );
    expect(calls.prompts).toEqual([]);
    expect(calls.continues).toBe(1);
  });

  it('reuses the fixture temp dir so the loader reads real files', () => {
    expect(fixture.root).toBe(process.env.OPENMAIC_AGENT_SKILLS_DIR);
  });
});
