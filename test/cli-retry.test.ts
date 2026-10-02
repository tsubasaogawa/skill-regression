import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveCases } from '../src/cases/load.js';
import type { Case } from '../src/cases/types.js';
import { hashCaseInputs, hashDir } from '../src/cases/hash.js';
import { program } from '../src/cli.js';
import { cacheKey, Store } from '../src/store/store.js';
import type { RunResult } from '../src/runner/types.js';
import { runSkill, runSkillCase } from '../src/runner/promptfoo.js';
import { JUDGE_PROVIDER } from '../src/config/defaults.js';

vi.mock('../src/runner/promptfoo.js', () => ({
  runSkill: vi.fn(),
  runSkillCase: vi.fn(),
}));

vi.mock('../src/runner/version.js', () => ({
  cliVersion: vi.fn(() => 'claude-test'),
}));

const tempDirs: string[] = [];
const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(runSkill).mockReset();
  vi.mocked(runSkillCase).mockReset();
  process.exitCode = originalExitCode;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('reruns only ambiguous cases, caps the last batch, and appends results under the same cache key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skilldrift-cli-retry-'));
  tempDirs.push(root);
  const skillsDir = join(root, 'skills');
  const skillDir = join(skillsDir, 'demo');
  const evalsDir = join(skillDir, 'evals');
  const storeDir = join(root, 'store');
  const fixturesDir = join(root, 'fixtures');
  const outDir = join(root, 'report');
  mkdirSync(evalsDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: test\n---\n');
  const cases: Case[] = ['resolves', 'at-limit', 'stable'].map((name) => ({
    name,
    prompt: `test ${name}`,
    tags: ['quality' as const],
    files: [],
    assertions: [],
  }));
  writeFileSync(join(evalsDir, 'cases.yaml'), stringify(cases));
  const suitePath = join(root, 'suite.yaml');
  writeFileSync(suitePath, 'baseline_model: old-model\nskills: [demo]\nruns: 5\naggregate_drop_pt: 0.1\n');

  const makeResults = (caseNames: string[], model: string, runs: number, passes: (name: string, index: number) => boolean): RunResult[] =>
    caseNames.flatMap((name) => Array.from({ length: runs }, (_, run_idx) => ({
      skill: 'demo',
      case: name,
      agent: 'claude',
      model,
      run_idx,
      passed: passes(name, run_idx),
      score: passes(name, run_idx) ? 1 : 0,
      triggered: true,
      judge_dependent: false,
      latency_ms: 1,
    })));

  vi.mocked(runSkill).mockImplementation(async (sc, options) => ({
    results: makeResults(
      sc.cases.map((testCase) => testCase.name),
      options.models[0],
      options.runs,
      (name, index) => options.models[0] === 'old-model' || name === 'stable' || index < 3,
    ),
    raw: {} as never,
  }));
  vi.mocked(runSkillCase).mockImplementation(async (_sc, caseName, options) => ({
    results: makeResults(
      [caseName],
      options.models[0],
      options.runs,
      (name) => name === 'at-limit' || options.models[0] === 'old-model',
    ),
    raw: {} as never,
  }));

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;

  await program.parseAsync([
    'compare',
    '--suite', suitePath,
    '--skills-dir', skillsDir,
    '--fixtures-dir', fixturesDir,
    '--new', 'new-model',
    '--runs-max', '12',
    '--judge', 'judge-model',
    '--concurrency', '1',
    '--store', storeDir,
    '--out', outDir,
    '--format', 'json',
  ], { from: 'user' });

  expect(vi.mocked(runSkillCase).mock.calls.map(([, caseName, options]) => [caseName, options.models[0], options.runs])).toEqual([
    ['resolves', 'old-model', 5],
    ['resolves', 'new-model', 5],
    ['at-limit', 'old-model', 5],
    ['at-limit', 'new-model', 5],
    ['at-limit', 'old-model', 2],
    ['at-limit', 'new-model', 2],
  ]);
  expect(process.exitCode).toBe(1);

  const sc = resolveCases(skillsDir, 'demo');
  const stored = (model: string) => new Store(storeDir).lookup(cacheKey({
    skill: 'demo',
    skillHash: hashDir(sc.dir),
    casesHash: hashCaseInputs(sc.cases, sc.dir),
    model,
    judge: `${JUDGE_PROVIDER}:judge-model`,
    runsMax: 12,
  }));
  const oldResults = stored('old-model');
  const newResults = stored('new-model');
  const countFor = (results: RunResult[], name: string) => results.filter((result) => result.case === name).length;
  expect(['resolves', 'at-limit', 'stable'].map((name) => countFor(oldResults, name))).toEqual([10, 12, 5]);
  expect(['resolves', 'at-limit', 'stable'].map((name) => countFor(newResults, name))).toEqual([10, 12, 5]);

  const verdicts = readFileSync(join(storeDir, 'verdicts.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { case: string | null; verdict: string });
  expect(Object.fromEntries(verdicts.filter((v) => v.case).map((v) => [v.case, v.verdict]))).toEqual({
    resolves: 'REGRESSED',
    'at-limit': 'INCONCLUSIVE',
    stable: 'UNCHANGED',
  });
});

it('reruns a trigger-tagged case when only trigger correctness is ambiguous', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skilldrift-cli-trigger-'));
  tempDirs.push(root);
  const skillsDir = join(root, 'skills');
  const skillDir = join(skillsDir, 'demo');
  const evalsDir = join(skillDir, 'evals');
  mkdirSync(evalsDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: test\n---\n');
  writeFileSync(join(evalsDir, 'cases.yaml'), stringify([{
    name: 'should-trigger',
    prompt: 'test trigger',
    tags: ['trigger'],
    files: [],
    assertions: [],
  } satisfies Case]));
  const suitePath = join(root, 'suite.yaml');
  writeFileSync(suitePath, 'baseline_model: old-model\nskills: [demo]\nruns: 5\n');
  const makeResults = (model: string, count: number, triggered: (index: number) => boolean): RunResult[] =>
    Array.from({ length: count }, (_, run_idx) => ({
      skill: 'demo',
      case: 'should-trigger',
      agent: 'claude',
      model,
      run_idx,
      passed: true,
      score: 1,
      triggered: triggered(run_idx),
      judge_dependent: false,
      latency_ms: 1,
    }));

  vi.mocked(runSkill).mockImplementation(async (_sc, options) => ({
    results: makeResults(options.models[0], options.runs, (i) => options.models[0] === 'old-model' || i < 3),
    raw: {} as never,
  }));
  vi.mocked(runSkillCase).mockImplementation(async (_sc, _caseName, options) => ({
    results: makeResults(options.models[0], options.runs, () => options.models[0] === 'old-model'),
    raw: {} as never,
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;

  const outDir = join(root, 'report');
  await program.parseAsync([
    'compare',
    '--suite', suitePath,
    '--skills-dir', skillsDir,
    '--fixtures-dir', join(root, 'fixtures'),
    '--new', 'new-model',
    '--runs-max', '10',
    '--judge', 'judge-model',
    '--concurrency', '1',
    '--store', join(root, 'store'),
    '--out', outDir,
    '--format', 'json',
  ], { from: 'user' });

  expect(vi.mocked(runSkillCase).mock.calls.map(([, , options]) => [options.models[0], options.runs])).toEqual([
    ['old-model', 5],
    ['new-model', 5],
  ]);
  expect(process.exitCode).toBe(1);
  const report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as {
    skills: { verdict: string; trigger: { new: { recall: number }; verdict: string } }[];
  };
  expect(report.skills[0].verdict).toBe('REGRESSED');
  expect(report.skills[0].trigger).toMatchObject({ verdict: 'REGRESSED', new: { recall: 0.3 } });
});

it('reruns all trigger cases when aggregate recall is ambiguous but each case is unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skilldrift-cli-recall-'));
  tempDirs.push(root);
  const skillsDir = join(root, 'skills');
  mkdirSync(join(skillsDir, 'demo', 'evals'), { recursive: true });
  writeFileSync(join(skillsDir, 'demo', 'SKILL.md'), '# demo');
  writeFileSync(join(skillsDir, 'demo', 'evals', 'cases.yaml'), stringify(
    ['t1', 't2'].map((name) => ({ name, prompt: name, tags: ['trigger'], files: [], assertions: [] })),
  ));
  const suitePath = join(root, 'suite.yaml');
  writeFileSync(suitePath, 'baseline_model: old\nruns: 5\n');
  const makeResults = (name: string, model: string, count: number, initial: boolean): RunResult[] =>
    Array.from({ length: count }, (_, run_idx) => ({
      skill: 'demo', case: name, agent: 'claude', model, run_idx,
      passed: true, score: 1, triggered: model === 'old' || (initial && run_idx < 4),
      judge_dependent: false, latency_ms: 0,
    }));
  vi.mocked(runSkill).mockImplementation(async (sc, opts) => ({
    results: sc.cases.flatMap((c) => makeResults(c.name, opts.models[0], opts.runs, true)), raw: {} as never,
  }));
  vi.mocked(runSkillCase).mockImplementation(async (_sc, name, opts) => ({
    results: makeResults(name, opts.models[0], opts.runs, false), raw: {} as never,
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await program.parseAsync([
    'compare', '--suite', suitePath, '--skills-dir', skillsDir,
    '--new', 'new', '--runs-max', '10', '--store', join(root, 'store'),
    '--fixtures-dir', join(root, 'fixtures'), '--out', join(root, 'report'), '--format', 'json',
  ], { from: 'user' });
  expect(vi.mocked(runSkillCase).mock.calls.map(([, name, opts]) => [name, opts.models[0]])).toEqual([
    ['t1', 'old'], ['t1', 'new'], ['t2', 'old'], ['t2', 'new'],
  ]);
  expect(process.exitCode).toBe(1);
});
