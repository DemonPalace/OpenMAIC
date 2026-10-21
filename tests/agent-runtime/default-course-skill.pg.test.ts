import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/agent-runtime/config', () => ({
  agentRuntimeConfig: { skillsDir: '/nonexistent' },
}));
vi.mock('@/lib/server/agent-runtime/user-skills', () => ({
  listUserSkills: vi.fn(async () => []),
}));

import {
  ensureAgentSessionSchema,
  PgAgentSessionStore,
  type Queryable,
  type WithTransaction,
} from '../../packages/@openmaic/storage/src/agent-session/pg';
import { readPriorRunRecord } from '@/lib/server/agent-runtime/entry-tree-storage';
import { listAgentUserMessages } from '@/lib/server/agent-runtime/user-messages';
import { defaultCourseSkill, openingRequestOf } from '@/lib/server/agent-runtime/skill-preload';
import type { LoadedSkill } from '@/lib/server/agent-runtime/skills';

const contractUrl = process.env.PG_CONTRACT_URL;
const TEST_SCHEMA = `openmaic_default_course_skill_${process.pid}`;

function transactionFor(pool: Pool): WithTransaction {
  return async (body) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client as Queryable);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

const builtin = (id: string): LoadedSkill => ({
  id,
  name: id,
  description: `${id} courses`,
  content: `# ${id}`,
  filePath: `/skills/${id}/SKILL.md`,
  constraints: null,
  source: 'builtin',
});
const SKILLS = [builtin('stage-design'), builtin('pro-editing')];

/**
 * The default course skill decided from what the real store records: every
 * session carries a stage id (a placeholder when the caller passed none), so
 * only `existingCourse` and the opening message's references may exclude it.
 */
describe.skipIf(!contractUrl)('default course skill against the PostgreSQL session store', () => {
  const claimOptions = { leaseTtlMs: 10_000, maxAttempts: 5 };
  let admin: Pool;
  let pool: Pool;
  let store: PgAgentSessionStore;

  beforeAll(async () => {
    admin = new Pool({ connectionString: contractUrl });
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    pool = new Pool({ connectionString: contractUrl, options: `-c search_path=${TEST_SCHEMA}` });
    await ensureAgentSessionSchema(pool as Queryable);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE agent_session_entries, agent_session_events,
                agent_owner_session_events, agent_owner_session_event_counters,
                agent_sessions CASCADE`,
    );
    store = new PgAgentSessionStore(pool as Queryable, { withTransaction: transactionFor(pool) });
  });

  afterAll(async () => {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    } finally {
      await Promise.all([pool?.end(), admin.end()]);
    }
  });

  /** What the runner decides on the claimed session's first prompt path. */
  async function decideForClaim() {
    const meta = await store.claimNextSession('worker-1', 1, claimOptions);
    expect(meta).not.toBeNull();
    const messages = await listAgentUserMessages(store, meta!.id);
    const prior = await readPriorRunRecord(store, meta!.id);
    const opening = openingRequestOf(messages, prior.firstRunSeq ?? undefined, meta!.prompt);
    const skill = defaultCourseSkill({
      turn: {
        path: 'prompt',
        ...(opening.seq !== null ? { durableMessageSeq: opening.seq } : {}),
        startsTranscript: true,
      },
      opening,
      existingCourse: meta!.existingCourse,
      ...(meta!.skillId ? { frozenSkillId: meta!.skillId } : {}),
      skills: SKILLS,
    });
    return { meta: meta!, skill };
  }

  it('loads for an ordinary session that only has a placeholder stage id', async () => {
    const created = await store.createSession({
      id: 'plain-session',
      ownerId: 'owner',
      prompt: 'Make a lesson on light refraction',
    });
    // The store fills the stage id in; its presence is not an attached course.
    expect(created.stageId).toBeTruthy();

    const { meta, skill } = await decideForClaim();
    expect(meta.stageId).toBe(created.stageId);
    expect(meta.existingCourse).toBe(false);
    expect(skill?.id).toBe('stage-design');
  });

  it('loads when the opening message carries materials', async () => {
    await store.createSession({
      id: 'material-session',
      ownerId: 'owner',
      prompt: 'Turn this handout into a class',
      status: 'succeeded',
    });
    await store.postUserMessage('material-session', {
      text: 'Turn this handout into a class',
      materials: [{ id: 'material-1', name: 'handout.pdf' }],
    });

    const { skill } = await decideForClaim();
    expect(skill?.id).toBe('stage-design');
  });

  it('does not load for a session attached to an existing course', async () => {
    await store.createSession({
      id: 'attached-session',
      ownerId: 'owner',
      prompt: 'stage-existing',
      stageId: 'stage-existing',
      existingCourse: true,
    });

    const { skill } = await decideForClaim();
    expect(skill).toBeNull();
  });

  it('does not load when the opening message names an element', async () => {
    await store.createSession({
      id: 'element-ref-session',
      ownerId: 'owner',
      prompt: 'Fix this',
      status: 'succeeded',
    });
    await store.postUserMessage('element-ref-session', {
      text: 'Fix this',
      elementRefs: [{ stageId: 'stage-a', sceneId: 'scene-1', elementId: 'el-1' }],
    });

    const { skill } = await decideForClaim();
    expect(skill).toBeNull();
  });

  it('does not load when the opening message names a course', async () => {
    await store.createSession({
      id: 'course-ref-session',
      ownerId: 'owner',
      prompt: 'Improve page 3',
      status: 'succeeded',
    });
    await store.postUserMessage('course-ref-session', {
      text: 'Improve page 3',
      courseRefs: [{ kind: 'course', stageId: 'stage-a', title: 'Optics' }],
    });

    const { skill } = await decideForClaim();
    expect(skill).toBeNull();
  });
});
