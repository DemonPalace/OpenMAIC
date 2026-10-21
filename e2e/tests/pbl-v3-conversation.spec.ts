import { test, expect } from '@playwright/test';
import { seedServerDocument, uniqueStageId } from '../fixtures/server-seed';
import { createSettingsStorage } from '../fixtures/test-data/settings';
import { defaultTheme } from '../fixtures/test-data/slide-theme';
import type { LearningView } from '@/lib/pbl/v3/types';

test('PBL conversation stays in the host classroom through expansion, scene navigation and refresh', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(
    (settings) => {
      localStorage.setItem('locale', 'en-US');
      localStorage.setItem('maic:account:settings-storage', settings);
    },
    createSettingsStorage({ sidebarCollapsed: false }),
  );
  const stageId = uniqueStageId('pbl-ui');
  await seedServerDocument(page, {
    stage: {
      id: stageId,
      name: 'Programming course',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    scenes: [
      {
        id: 'overview',
        stageId,
        type: 'slide',
        title: 'Course overview',
        order: 0,
        content: {
          type: 'slide',
          canvas: {
            id: 'overview-slide',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            theme: defaultTheme,
            elements: [
              {
                type: 'text',
                id: 'intro-text',
                content: 'Course overview',
                left: 50,
                top: 50,
                width: 900,
                height: 100,
              },
            ],
          },
        },
      },
      {
        id: 'project',
        stageId,
        type: 'pbl',
        title: 'Practice project',
        order: 1,
        content: { type: 'pbl', projectV3: { id: 'greeting-python-lab', version: '1.0.0' } },
        actions: [],
      },
    ],
    outline: {
      outlines: [],
      generationComplete: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  const view = {
    id: 'ui-study',
    revision: 8,
    activitySequence: 10,
    title: 'Greeting project',
    task: { title: 'Implement a greeting', goal: 'Connect input to output' },
    environmentId: 'fixture-environment',
    environment: { state: 'running', ready: true },
    recovery: null,
    state: {
      status: 'running',
      introCompleted: true,
      position: { milestoneIndex: 0, milestoneId: 'greeting', stageIndex: 0 },
      milestones: [{ milestoneId: 'greeting', status: 'active' }],
      collected: { greeting: { decisions: [] } },
      decisionRevisions: {},
      lastSequence: 1,
    },
    stage: {
      kind: 'mentor_say',
      agent: 'discussion',
      say: 'Explain',
      studentActions: ['chat', 'next'],
    },
    milestones: [
      {
        id: 'greeting',
        title: 'Implement a greeting',
        optional: false,
        stages: ['teaching', 'dialogue', 'plan', 'code', 'tests', 'quiz', 'recap'],
      },
      {
        id: 'normalize',
        title: 'Extend the greeting',
        optional: false,
        stages: ['teaching', 'plan', 'code', 'tests', 'quiz', 'recap'],
      },
    ],
    role: 'discussion',
    actions: ['chat'],
    files: ['PLAN.md'],
    busy: false,
    messages: [],
    roleRun: null,
    decisions: [],
    questions: [],
    evaluation: null,
    conversation: [
      {
        id: 'u1',
        speaker: 'user',
        parts: [{ kind: 'text', id: '1', text: 'I do not understand return.' }],
      },
      {
        id: 'a1',
        speaker: 'discussion',
        parts: [
          { kind: 'text', id: '2', text: 'Return sends a value to the caller.' },
          { kind: 'tool', id: '3', action: 'review', status: 'succeeded' },
          { kind: 'text', id: '4', text: 'Where does the value go?' },
        ],
      },
    ],
  } as unknown as LearningView;
  await page.route('**/api/pbl/v3**', async (route) => {
    if (new URL(route.request().url()).searchParams.has('file'))
      return route.fulfill({
        json: {
          text: '## Greeting plan\nConnect input to a returned greeting.',
          hash: 'a'.repeat(64),
        },
      });
    // Also supports local combination with the companion workbench PR.
    if (new URL(route.request().url()).pathname.endsWith('/workspace'))
      return route.fulfill({
        json: {
          environmentId: view.environmentId,
          revision: view.revision,
          epoch: 0,
          canEdit: false,
          canManageFiles: false,
          canRun: false,
          planning: false,
          ports: [],
          commands: [],
          terminals: [],
          checkpoint: null,
        },
      });
    if (new URL(route.request().url()).pathname.endsWith('/report'))
      return route.fulfill({
        json: {
          studyId: view.id,
          project: { id: 'greeting', version: '1', title: view.title },
          revision: 8,
          requiredComplete: false,
          milestones: [],
          evidence: [],
          counts: {},
          conversations: [],
          truncated: false,
        },
      });
    return route.fulfill({ json: view });
  });
  await page.goto(`/classroom/${stageId}`);
  await page.getByTestId('scene-title').filter({ hasText: 'Practice project' }).click();
  await expect(page.getByTestId('pbl-v3-workspace')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Current learning step' })
      .getByText('Learn before deciding', { exact: true }),
  ).toBeVisible();
  const task = page.getByRole('region', { name: 'Current learning step', exact: true });
  const details = page.getByRole('region', { name: 'Current task details', exact: true });
  await expect(task.getByText('1/7', { exact: true })).toBeVisible();
  const composerBefore = await page.getByLabel('Your message', { exact: true }).boundingBox();
  await task.getByRole('button', { name: /Current task details/ }).click();
  await expect(details).toBeVisible();
  await expect(details.getByRole('listitem')).toHaveCount(7);
  const composerAfter = await page.getByLabel('Your message', { exact: true }).boundingBox();
  expect(composerAfter?.y).toBe(composerBefore?.y);
  await details.getByRole('button', { name: 'Close task details' }).press('Escape');
  await expect(details).toBeHidden();
  await expect(task.getByRole('button', { name: /Current task details/ })).toBeFocused();
  // Opening task details must not submit an answer or advance the learning state.
  expect(view.revision).toBe(8);
  view.state.introCompleted = false;
  view.revision++;
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(task.getByText('0/7', { exact: true })).toBeVisible();
  view.state.introCompleted = true;
  view.state.position = { milestoneIndex: 1, milestoneId: 'normalize', stageIndex: 2 };
  view.revision++;
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(task.getByText('3/6', { exact: true })).toBeVisible();
  view.state.position = { milestoneIndex: 0, milestoneId: 'greeting', stageIndex: 0 };
  view.revision++;
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(task.getByText('1/7', { exact: true })).toBeVisible();
  const conversation = page.getByRole('log', { name: 'Learning conversation' });
  await expect(conversation.getByText('Discussion', { exact: true })).toBeVisible();
  await conversation.getByText('Waiting for your review', { exact: true }).click();
  await expect(
    conversation.getByText('Read the question in the conversation and respond in your own words.'),
  ).toBeVisible();
  view.conversation![1]!.parts.push({
    kind: 'text',
    id: 'streaming',
    text: 'A partial explanation',
    streaming: true,
  });
  view.activitySequence = 11;
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(conversation.getByText('A partial explanation', { exact: true })).toHaveCount(1);
  const partial = view.conversation![1]!.parts.at(-1)!;
  if (partial.kind === 'text') {
    partial.text = 'A completed explanation';
    partial.streaming = false;
  }
  view.activitySequence = 12;
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(conversation.getByText('A completed explanation', { exact: true })).toHaveCount(1);
  await expect(conversation.getByText('A partial explanation', { exact: true })).toHaveCount(0);
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Greeting plan');
  await page.getByLabel('Your message', { exact: true }).fill('My draft answer');
  await page.getByRole('button', { name: 'Expand project workspace' }).click();
  await expect(page.getByRole('button', { name: 'Return to classroom layout' })).toBeVisible();
  await expect(page.getByLabel('Your message', { exact: true })).toHaveValue('My draft answer');
  await page.getByTestId('pbl-v3-frame').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/pbl-v3-conversation.png' });
  await page.getByRole('button', { name: 'Return to classroom layout' }).click();
  await page.getByTestId('scene-title').filter({ hasText: 'Course overview' }).click();
  await expect(page.getByTestId('pbl-v3-workspace')).toHaveCount(0);
  await page.getByTestId('scene-title').filter({ hasText: 'Practice project' }).click();
  await expect(page.getByText('Return sends a value to the caller.')).toBeVisible();
  await page.reload();
  // The host may select its first scene on reload; select the same installed PBL again.
  await page.getByTestId('scene-title').filter({ hasText: 'Practice project' }).click();
  await expect(page.getByText('Return sends a value to the caller.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Expand project workspace' }).click();
  await expect(page.getByLabel('Your message', { exact: true })).toBeVisible();
  await page.getByTestId('pbl-v3-frame').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/pbl-v3-conversation-mobile.png' });
  await expect(page.locator('[data-testid="pbl-v3-workspace"]')).toHaveJSProperty(
    'scrollWidth',
    await page.getByTestId('pbl-v3-workspace').evaluate((el) => el.clientWidth),
  );
});
