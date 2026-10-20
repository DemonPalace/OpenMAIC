import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
vi.mock('server-only', () => ({}));
import { installedProject } from '@/lib/server/pbl-v3/catalog';
import { evaluationCommand, evaluationPassed } from '@/lib/server/pbl-v3/evaluation';
const spec = installedProject({ id: 'greeting-python', version: '1.0.0' }).evaluations.greeting!;
describe('trusted evaluation driver', () => {
  it.each([
    ['def greet(name): return f"Hello, {name}!"', true],
    ['import sys\nsys.exit(0)', false],
    ['def greet(name): return "wrong"', false],
    ['raise RuntimeError("broken import")', false],
  ])('checks actual output rather than child exit success: %s', async (code, passed) => {
    const root = await mkdtemp(join(tmpdir(), 'pbl-eval-'));
    try {
      await writeFile(join(root, 'greeting.py'), code);
      const result = await promisify(execFile)(
        '/bin/sh',
        ['-c', evaluationCommand(spec, 'run-1')],
        { cwd: root, timeout: 10000 },
      );
      expect(evaluationPassed(spec, 'run-1', result.stdout)).toBe(passed);
      expect(evaluationPassed(spec, 'other-run', result.stdout)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects missing, duplicated and partial completion records', () => {
    expect(evaluationPassed(spec, 'id', '')).toBe(false);
    expect(evaluationPassed(spec, 'id', 'PBL_RESULT:id:{"build":true,"checks":[]}')).toBe(false);
    const line =
      'PBL_RESULT:id:' +
      JSON.stringify({ build: true, checks: spec.cases.map((c) => ({ id: c.id, passed: true })) });
    expect(evaluationPassed(spec, 'id', line)).toBe(true);
    expect(evaluationPassed(spec, 'id', line + '\n' + line)).toBe(false);
  });
});
