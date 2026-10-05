import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { hashCaseInputs, hashDir } from '../src/cases/hash.js';
import { resolveCases } from '../src/cases/load.js';
import type { Case } from '../src/cases/types.js';
import { program } from '../src/cli.js';
import { JUDGE_PROVIDER } from '../src/config/defaults.js';
import { runSkill, runSkillCase } from '../src/runner/promptfoo.js';
import type { RunResult } from '../src/runner/types.js';
import { cacheKey, Store } from '../src/store/store.js';
import { aCase, result, silence, tmpRoot, writeSkill } from './helpers.js';

vi.mock('../src/runner/promptfoo.js', () => ({ runSkill: vi.fn(), runSkillCase: vi.fn() }));
vi.mock('../src/runner/version.js', () => ({ cliVersion: vi.fn(() => 'claude-test') }));

afterEach(() => { vi.mocked(runSkill).mockReset(); vi.mocked(runSkillCase).mockReset(); });

/** One skill "demo" with the given cases; compare args write a JSON report to <root>/report. */
function setup(cases: Case[], suite: string) {
  const root = tmpRoot();
  const skillsDir = join(root, 'skills');
  writeSkill(skillsDir, 'demo', cases);
  writeFileSync(join(root, 'suite.yaml'), suite);
  silence();
  const args = ['compare', '--suite', join(root, 'suite.yaml'), '--skills-dir', skillsDir, '--fixtures-dir', join(root, 'fixtures'), '--new', 'new-model', '--judge', 'judge-model', '--concurrency', '1', '--store', join(root, 'store'), '--out', join(root, 'report'), '--format', 'json'];
  return { root, skillsDir, args };
}
const series = (name: string, model: string, runs: number, at: (i: number) => Partial<RunResult>): RunResult[] =>
  Array.from({ length: runs }, (_, run_idx) => result({ skill: 'demo', case: name, model, run_idx, ...at(run_idx) }));
const pass = (p: boolean) => ({ passed: p, score: p ? 1 : 0 });
const isOld = (model: string) => model === 'old-model';

it('reruns only ambiguous cases, caps the last batch, and appends results under the same cache key', async () => {
  const names = ['resolves', 'at-limit', 'stable'];
  const { root, skillsDir, args } = setup(names.map((n) => aCase(n)), 'baseline_model: old-model\nskills: [demo]\nruns: 5\naggregate_drop_pt: 0.1\n');
  vi.mocked(runSkill).mockImplementation(async (sc, o) => ({
    results: sc.cases.flatMap((c) => series(c.name, o.models[0], o.runs, (i) => pass(isOld(o.models[0]) || c.name === 'stable' || i < 3))), raw: {} as never,
  }));
  vi.mocked(runSkillCase).mockImplementation(async (_sc, name, o) => ({
    results: series(name, o.models[0], o.runs, () => pass(name === 'at-limit' || isOld(o.models[0]))), raw: {} as never,
  }));

  await program.parseAsync([...args, '--runs-max', '12'], { from: 'user' });

  expect(vi.mocked(runSkillCase).mock.calls.map(([, name, o]) => [name, o.models[0], o.runs])).toEqual([
    ['resolves', 'old-model', 5],
    ['resolves', 'new-model', 5],
    ['at-limit', 'old-model', 5],
    ['at-limit', 'new-model', 5],
    ['at-limit', 'old-model', 2],
    ['at-limit', 'new-model', 2],
  ]);
  expect(process.exitCode).toBe(1);

  const sc = resolveCases(skillsDir, 'demo');
  const stored = (model: string) => new Store(join(root, 'store')).lookup(cacheKey({
    skill: 'demo', skillHash: hashDir(sc.dir), casesHash: hashCaseInputs(sc.cases, sc.dir), model, judge: `${JUDGE_PROVIDER}:judge-model`, runsMax: 12,
  }));
  const count = (rs: RunResult[], name: string) => rs.filter((r) => r.case === name).length;
  expect(names.map((n) => count(stored('old-model'), n))).toEqual([10, 12, 5]);
  expect(names.map((n) => count(stored('new-model'), n))).toEqual([10, 12, 5]);

  const verdicts = readFileSync(join(root, 'store', 'verdicts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { case: string | null; verdict: string });
  expect(Object.fromEntries(verdicts.filter((v) => v.case).map((v) => [v.case, v.verdict]))).toEqual({ resolves: 'REGRESSED', 'at-limit': 'INCONCLUSIVE', stable: 'UNCHANGED' });
});

it('reruns a trigger-tagged case when only trigger correctness is ambiguous', async () => {
  const { root, args } = setup([aCase('should-trigger', { tags: ['trigger'] })], 'baseline_model: old-model\nskills: [demo]\nruns: 5\n');
  vi.mocked(runSkill).mockImplementation(async (_sc, o) => ({ results: series('should-trigger', o.models[0], o.runs, (i) => ({ triggered: isOld(o.models[0]) || i < 3 })), raw: {} as never }));
  vi.mocked(runSkillCase).mockImplementation(async (_sc, _n, o) => ({ results: series('should-trigger', o.models[0], o.runs, () => ({ triggered: isOld(o.models[0]) })), raw: {} as never }));

  await program.parseAsync([...args, '--runs-max', '10'], { from: 'user' });

  expect(vi.mocked(runSkillCase).mock.calls.map(([, , o]) => [o.models[0], o.runs])).toEqual([['old-model', 5], ['new-model', 5]]);
  expect(process.exitCode).toBe(1);
  const report = JSON.parse(readFileSync(join(root, 'report', 'report.json'), 'utf8')) as { skills: { verdict: string; trigger: object }[] };
  expect(report.skills[0].verdict).toBe('REGRESSED');
  expect(report.skills[0].trigger).toMatchObject({ verdict: 'REGRESSED', new: { recall: 0.3 } });
});

it('reruns all trigger cases when aggregate recall is ambiguous but each case is unchanged', async () => {
  const { args } = setup(['t1', 't2'].map((n) => aCase(n, { tags: ['trigger'] })), 'baseline_model: old-model\nruns: 5\n');
  vi.mocked(runSkill).mockImplementation(async (sc, o) => ({
    results: sc.cases.flatMap((c) => series(c.name, o.models[0], o.runs, (i) => ({ triggered: isOld(o.models[0]) || i < 4 }))), raw: {} as never,
  }));
  vi.mocked(runSkillCase).mockImplementation(async (_sc, name, o) => ({ results: series(name, o.models[0], o.runs, () => ({ triggered: isOld(o.models[0]) })), raw: {} as never }));

  await program.parseAsync([...args, '--runs-max', '10'], { from: 'user' });

  expect(vi.mocked(runSkillCase).mock.calls.map(([, name, o]) => [name, o.models[0]])).toEqual([
    ['t1', 'old-model'], ['t1', 'new-model'], ['t2', 'old-model'], ['t2', 'new-model'],
  ]);
  expect(process.exitCode).toBe(1);
});

it.each([
  [true, ['skill_used', 'llm_rubric']],
  [false, ['skill_used']],
])('llm_rubric enabled=%s passes assertions %j to the runner', async (enabled, expected) => {
  const { args } = setup([aCase('q', { assertions: [{ type: 'skill_used' }, { type: 'llm_rubric', rubric: 'r' }] })], 'baseline_model: old-model\nruns: 1\n');
  vi.mocked(runSkill).mockImplementation(async (sc, o) => ({ results: sc.cases.flatMap((c) => series(c.name, o.models[0], o.runs, () => pass(true))), raw: {} as never }));

  await program.parseAsync(enabled ? args : [...args, '--no-llm-rubric'], { from: 'user' });

  const [sc] = vi.mocked(runSkill).mock.calls[0];
  expect(sc.cases[0].assertions.map((a) => a.type)).toEqual(expected);
});
