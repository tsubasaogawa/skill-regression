import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterEach, vi } from 'vitest';
import type { Case } from '../src/cases/types.js';
import type { RunResult } from '../src/runner/types.js';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Fresh temp dir, removed after the test. */
export function tmpRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'skill-regression-'));
  dirs.push(d);
  return d;
}

/** <skillsDir>/<name>/SKILL.md plus evals/cases.yaml when cases are given. */
export function writeSkill(skillsDir: string, name: string, cases?: Case[], md = `# ${name}`): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), md);
  if (cases) {
    mkdirSync(join(dir, 'evals'), { recursive: true });
    writeFileSync(join(dir, 'evals', 'cases.yaml'), stringify(cases));
  }
  return dir;
}

export const aCase = (name: string, over: Partial<Case> = {}): Case => ({ name, prompt: name, tags: ['quality'], files: [], assertions: [], ...over });

export const result = (over: Partial<RunResult> = {}): RunResult =>
  ({ skill: 's', case: 'c', agent: 'claude', model: 'm', run_idx: 0, passed: true, triggered: true, judge_dependent: false, ...over });

export function silence(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}
