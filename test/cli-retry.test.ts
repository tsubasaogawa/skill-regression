import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveCases } from '../src/cases/load.js';
import type { Case } from '../src/cases/types.js';
import { hashCases, hashDir } from '../src/cases/hash.js';
import { program } from '../src/cli.js';
import { cacheKey, Store } from '../src/store/store.js';
import type { RunResult } from '../src/runner/types.js';
import { runSkill, runSkillCase } from '../src/runner/promptfoo.js';

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
    '--skills-dir', skillsDir,
    '--fixtures-dir', fixturesDir,
    '--skill', 'demo',
    '--old', 'old-model',
    '--new', 'new-model',
    '--runs', '5',
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
    casesHash: hashCases(sc.cases),
    model,
    judge: 'judge-model',
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
