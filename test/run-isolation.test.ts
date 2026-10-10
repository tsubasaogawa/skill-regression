import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ApiProvider, CallApiContextParams, EvaluateTestSuite } from 'promptfoo';
import { expect, it, vi } from 'vitest';
import { resolveCases } from '../src/cases/load.js';
import { buildRunDirs } from '../src/planner/fixture.js';
import { runSkill } from '../src/runner/promptfoo.js';
import { aCase, tmpRoot, writeSkill } from './helpers.js';

const workingDirs: string[] = [];

/**
 * Stand-in for the Claude Agent SDK provider. Like the real one, it runs in `working_dir` from its config merged with the
 * prompt config. "write <path>" saves <path> and edits the case input; "read" returns the input plus any leftover output.
 * Every other call is slower, so with concurrency 2 two runs overlap and finish at different times.
 */
function fakeProvider(p: { id: string; label?: string; config?: Record<string, unknown> }): ApiProvider {
  let calls = 0;
  return {
    id: () => p.id,
    label: p.label,
    config: p.config,
    async callApi(prompt: string, context?: CallApiContextParams) {
      const wd = String({ ...p.config, ...context?.prompt?.config }.working_dir);
      workingDirs.push(wd);
      const delay = calls++ % 2 ? 200 : 50;
      let output = 'done';
      const target = prompt.match(/^write (\S+)$/)?.[1];
      if (target) {
        writeFileSync(target, 'out');
        writeFileSync(join(wd, 'evals', 'in.md'), 'changed');
      } else {
        output = readFileSync(join(wd, 'evals', 'in.md'), 'utf8') + (existsSync(join(wd, 'tmp', 'out.txt')) ? ' leftover' : '');
      }
      await new Promise((r) => setTimeout(r, delay));
      return { output };
    },
  };
}

vi.mock('promptfoo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('promptfoo')>();
  return {
    ...actual,
    evaluate: (suite: EvaluateTestSuite, options: Parameters<typeof actual.evaluate>[1]) =>
      actual.evaluate({ ...suite, providers: (suite.providers as { id: string }[]).map(fakeProvider) }, options),
  };
});

// Before the fix, every run shared one fixture: the writer's input edit leaked into the reader (bug 1), and the faster of
// two overlapping writer runs deleted the output the slower one had written before its file_exists check (bug 2).
it('runs every case and repeat in its own fresh working directory, even when runs overlap', async () => {
  const root = tmpRoot();
  const skillDir = writeSkill(join(root, 'skills'), 's', [
    aCase('writer', { prompt: 'write /tmp/out.txt', files: ['evals/in.md'], assertions: [{ type: 'file_exists', path: '/tmp/out.txt' }] }),
    aCase('reader', { prompt: 'read', files: ['evals/in.md'], assertions: [{ type: 'regex', pattern: '^original$' }] }),
  ]);
  writeFileSync(join(skillDir, 'evals', 'in.md'), 'original');
  mkdirSync(join(root, 'fixtures'));
  workingDirs.length = 0;

  const sc = resolveCases(join(root, 'skills'), 's');
  const { results } = await runSkill(sc, { models: ['m'], runs: 3, judgeModel: 'j', workingDir: resolve(buildRunDirs(sc, join(root, 'fixtures'), 3)), maxConcurrency: 2 });

  const outcome = (name: string) => results.filter((r) => r.case === name).map((r) => [r.passed, r.failed_assertions ?? []]);
  expect(outcome('writer')).toEqual([[true, []], [true, []], [true, []]]);
  expect(outcome('reader')).toEqual([[true, []], [true, []], [true, []]]);
  expect(new Set(workingDirs).size).toBe(6);
});
