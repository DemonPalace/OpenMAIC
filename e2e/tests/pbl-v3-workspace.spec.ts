import { test, expect } from '@playwright/test';
import type { LearningView } from '@/lib/pbl/v3/types';

/** Browser interaction contract; backend/runner/Python execution is covered by runtime.pg.test.ts. */
test.setTimeout(120000);

test('installed sample opens in the normal classroom and preserves progress after refresh', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en-US'));
  const state = {
    status: 'running',
    introCompleted: false,
    position: { milestoneIndex: 0, milestoneId: 'greeting', stageIndex: 0 },
    milestones: [],
    collected: {
      greeting: {
        decisions: [],
        decisionRecordIds: {},
        plan: null,
        code: null,
        tests: null,
        quiz: null as LearningView['state']['collected'][string]['quiz'],
        remediation: null,
      },
    },
    decisionRevisions: {},
    lastSequence: 1,
  };
  const view = {
    id: 'learning-browser',
    revision: 0,
    title: 'A friendly greeting',
    environmentId: null as string | null,
    state,
    stage: {
      kind: 'mentor_say',
      agent: 'mentor',
      say: 'Welcome',
      reads: [],
      studentActions: ['chat', 'next'],
    },
    role: 'mentor',
    actions: ['chat'],
    files: ['PLAN.md', 'greeting.py'],
    busy: false,
    messages: [] as { role: string; text: string }[],
    roleRun: null as LearningView['roleRun'],
    decisions: [],
    questions: [] as LearningView['questions'],
    evaluation: null,
  };
  let file = 'Write your plan here.';
  const calls: { type: string; path?: string; text?: string; expectedHash?: string }[] = [];
  await page.route('**/api/pbl/v3**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const body = req.method() === 'POST' ? req.postDataJSON() : null;
    if (body?.action === 'sample') return route.continue(); // actual course creation and persistence
    if (req.method() === 'GET' && url.searchParams.has('file'))
      return route.fulfill({ json: { text: file, hash: 'a'.repeat(64) } });
    if (body?.command) {
      calls.push(body.command);
      view.revision++;
      const command = body.command;
      if (command.type === 'prepare') view.environmentId = '12345678-1234-1234-1234-123456789012';
      if (command.type === 'chat') {
        view.messages.push(
          { role: 'user', text: command.text },
          { role: 'assistant', text: 'What should greet(name) return?' },
        );
      }
      if (command.type === 'save') file = command.text;
      if (command.type === 'quiz') {
        const passed = command.answers[0] === 0;
        view.state.collected.greeting.quiz = {
          id: command.id,
          attempt: (view.state.collected.greeting.quiz?.attempt ?? 0) + 1,
          passed,
          score: passed ? 1 : 0,
          total: 1,
          wrong: passed ? [] : [0],
        };
        view.actions = passed ? ['quiz', 'next'] : ['quiz'];
      }
      if (command.type === 'retry')
        view.roleRun = { status: 'succeeded', failure: null, canRetry: false };
      return route.fulfill({ json: { result: { accepted: true }, view } });
    }
    return route.fulfill({ json: view });
  });
  await page.goto('/pbl-v3');
  await page.getByRole('button', { name: 'Open Python sample' }).click();
  await expect(page).toHaveURL(/\/classroom\/pbl-/, { timeout: 60000 });
  await expect(page.getByTestId('pbl-v3-workspace')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Prepare project environment' }).click();
  await page.getByLabel('Your message').fill('Please introduce the project.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('What should greet(name) return?', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('What should greet(name) return?', { exact: true })).toBeVisible();
  expect(calls.filter((c) => c.type === 'prepare')).toHaveLength(1);
  expect(calls.filter((c) => c.type === 'chat')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/pbl-v3-workspace.png', fullPage: true });
  view.roleRun = { status: 'failed', failure: 'authentication', canRetry: true };
  const learningAlert = page.getByTestId('pbl-v3-workspace').getByRole('alert');
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  await expect(learningAlert).toContainText('could not authenticate');
  await page.reload();
  await expect(learningAlert).toContainText('could not authenticate');
  await page.screenshot({ path: 'test-results/pbl-v3-failure.png', fullPage: true });
  await page.getByRole('button', { name: 'Retry response' }).click();
  await expect(learningAlert).toHaveCount(0);
  expect(calls.filter((c) => c.type === 'retry')).toHaveLength(1);
  expect(calls.filter((c) => c.type === 'chat')).toHaveLength(1);
  // A late read from PLAN.md must not populate or become savable as greeting.py.
  view.actions = ['chat', 'edit'];
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  let releasePlan!: () => void, planStarted!: () => void;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  const planSeen = new Promise<void>((resolve) => {
    planStarted = resolve;
  });
  await page.route('**/api/pbl/v3?**', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('file');
    if (!path) return route.fallback();
    if (path === 'PLAN.md') {
      planStarted();
      await planGate;
    }
    await route.fulfill({
      json: {
        text: path === 'PLAN.md' ? 'Late plan response' : 'print("Current code")',
        hash: (path === 'PLAN.md' ? 'b' : 'c').repeat(64),
      },
    });
  });
  await page.getByRole('button', { name: 'Reload file' }).click();
  await planSeen;
  await page.getByRole('combobox', { name: 'Project files' }).selectOption('greeting.py');
  const editor = page.getByRole('textbox', { name: 'File contents' });
  await expect(editor).toHaveValue('print("Current code")');
  const lateResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get('file') === 'PLAN.md',
  );
  releasePlan();
  await lateResponse;
  await expect(editor).toHaveValue('print("Current code")');
  await editor.fill('print("Saved code")');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  expect(calls.at(-1)).toMatchObject({
    type: 'save',
    path: 'greeting.py',
    text: 'print("Saved code")',
    expectedHash: 'c'.repeat(64),
  });
  view.questions = [{ q: 'What does return do?', options: ['Returns a value', 'Prints a value'] }];
  view.actions = ['quiz'];
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  await page.getByRole('radio', { name: 'Prints a value' }).check();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(
    page.getByText('0/1 correct. Review your answers and try again.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('0/1 correct. Review your answers and try again.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Returns a value' }).check();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(
    page.getByText('Quiz passed: 1/1 correct. You can continue.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});
