/**
 * The default course skill — a plain opening request loads `stage-design`
 * without a `/` command (RFC #1957), and nothing the user already chose is
 * overridden: a frozen skill, a typed handle, an attached course, or a course
 * or element reference all keep their own meaning.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/agent-runtime/config', () => ({
  agentRuntimeConfig: { skillsDir: '/nonexistent' },
}));
vi.mock('@/lib/server/agent-runtime/user-skills', () => ({
  listUserSkills: vi.fn(async () => []),
}));

import {
  DEFAULT_COURSE_SKILL_ID,
  defaultCourseSkill,
  isOpeningTurn,
  openingMessageSeq,
  type DurableTurnSource,
  type OpeningRequest,
} from '@/lib/server/agent-runtime/skill-preload';
import type { LoadedSkill } from '@/lib/server/agent-runtime/skills';

const builtin = (id: string): LoadedSkill => ({
  id,
  name: id,
  description: `${id} courses`,
  content: `# ${id}`,
  filePath: `/skills/${id}/SKILL.md`,
  constraints: null,
  source: 'builtin',
});

const SKILLS = [builtin('pro-editing'), builtin('stage-design'), builtin('vocational')];

const PROMPT_START: DurableTurnSource = { path: 'prompt', startsTranscript: true };
const PLAIN: OpeningRequest = { seq: null, text: 'Make a lesson on light refraction' };

const decide = (
  overrides: Partial<Parameters<typeof defaultCourseSkill>[0]> = {},
): LoadedSkill | null =>
  defaultCourseSkill({
    turn: PROMPT_START,
    opening: PLAIN,
    existingCourse: false,
    skills: SKILLS,
    ...overrides,
  });

describe('openingMessageSeq', () => {
  it('is null when the session has no message rows', () => {
    expect(openingMessageSeq([], undefined)).toBeNull();
    expect(openingMessageSeq([], 5)).toBeNull();
  });

  it('takes the first row before any run started', () => {
    expect(openingMessageSeq([{ seq: 2 }, { seq: 9 }], undefined)).toBe(2);
  });

  it('takes the first row only when it precedes the first run frame', () => {
    expect(openingMessageSeq([{ seq: 2 }, { seq: 9 }], 3)).toBe(2);
    // Posted after the first run started: a follow-up, never the opening.
    expect(openingMessageSeq([{ seq: 4 }, { seq: 9 }], 3)).toBeNull();
  });
});

describe('isOpeningTurn', () => {
  it('prompt path: the opening row, or the session prompt on a fresh transcript', () => {
    expect(isOpeningTurn({ path: 'prompt', durableMessageSeq: 2, startsTranscript: true }, 2)).toBe(
      true,
    );
    expect(isOpeningTurn({ path: 'prompt', startsTranscript: true }, null)).toBe(true);
    // A first run whose opening row was judged a follow-up still answers the prompt.
    expect(isOpeningTurn({ path: 'prompt', startsTranscript: true }, 7)).toBe(true);
  });

  it('prompt path: a follow-up message, or a continued transcript without one, is not the opening', () => {
    expect(
      isOpeningTurn({ path: 'prompt', durableMessageSeq: 9, startsTranscript: false }, 2),
    ).toBe(false);
    expect(
      isOpeningTurn({ path: 'prompt', durableMessageSeq: 9, startsTranscript: true }, null),
    ).toBe(false);
    expect(isOpeningTurn({ path: 'prompt', startsTranscript: false }, null)).toBe(false);
  });

  it('resume path: nothing delivered yet, or the opening row delivered, is the opening', () => {
    expect(isOpeningTurn({ path: 'resume' }, null)).toBe(true);
    // The opening row exists but its delivery mark did not land.
    expect(isOpeningTurn({ path: 'resume' }, 2)).toBe(true);
    expect(isOpeningTurn({ path: 'resume', deliveredMessageSeq: 2 }, 2)).toBe(true);
  });

  it('resume path: a delivered follow-up is not the opening', () => {
    expect(isOpeningTurn({ path: 'resume', deliveredMessageSeq: 9 }, 2)).toBe(false);
    expect(isOpeningTurn({ path: 'resume', deliveredMessageSeq: 9 }, null)).toBe(false);
  });
});

describe('defaultCourseSkill', () => {
  it('loads stage-design for a plain opening request', () => {
    expect(DEFAULT_COURSE_SKILL_ID).toBe('stage-design');
    expect(decide()?.id).toBe('stage-design');
  });

  it('is unaffected by attached materials, which the opening request facts do not carry', () => {
    expect(decide({ opening: { seq: 2, text: 'Turn this handout into a class' } })?.id).toBe(
      'stage-design',
    );
  });

  it('does not apply to a later turn', () => {
    expect(
      decide({ turn: { path: 'prompt', durableMessageSeq: 9, startsTranscript: false } }),
    ).toBeNull();
    expect(decide({ turn: { path: 'resume', deliveredMessageSeq: 9 } })).toBeNull();
  });

  it('keeps an attached course attached', () => {
    expect(decide({ existingCourse: true })).toBeNull();
  });

  it('keeps a frozen session skill authoritative', () => {
    expect(decide({ frozenSkillId: 'vocational' })).toBeNull();
    expect(decide({ frozenSkillId: 'stage-design' })).toBeNull();
  });

  it('keeps a typed handle anywhere in the opening text', () => {
    expect(decide({ opening: { seq: null, text: '/vocational welding basics' } })).toBeNull();
    expect(decide({ opening: { seq: null, text: 'welding basics /vocational' } })).toBeNull();
  });

  it('treats an unknown handle as text, as every handle reader does', () => {
    expect(decide({ opening: { seq: null, text: '/not-a-skill welding basics' } })?.id).toBe(
      'stage-design',
    );
  });

  it('leaves a request naming a course or an element alone', () => {
    expect(
      decide({ opening: { seq: 2, text: 'Improve page 3', courseRefs: [{ stageId: 'stage-a' }] } }),
    ).toBeNull();
    expect(
      decide({ opening: { seq: 2, text: 'Fix this', elementRefs: [{ stageId: 'stage-a' }] } }),
    ).toBeNull();
  });

  it('reads references from the opening request even when the resumed text fell back to the prompt', () => {
    // S5: the opening row exists with a course reference, its delivery mark
    // did not land, and the resumed turn's text is the session prompt.
    expect(
      decide({
        turn: { path: 'resume' },
        opening: { seq: 2, text: 'Improve page 3', courseRefs: [{ stageId: 'stage-a' }] },
      }),
    ).toBeNull();
    expect(
      decide({ turn: { path: 'resume' }, opening: { seq: 2, text: 'Teach me SQL joins' } })?.id,
    ).toBe('stage-design');
  });

  it('falls back to discovery when the deployment does not install stage-design', () => {
    expect(decide({ skills: [builtin('pro-editing')] })).toBeNull();
  });
});
