import { expect, it } from 'vitest';
import { pRegressed } from '../src/comparator/beta.js';
import { compareSkill, toVerdict } from '../src/comparator/verdict.js';
import type { RunResult } from '../src/runner/types.js';

const runs = (model: string, c: string, passes: boolean[], error = false): RunResult[] =>
  passes.map((p, i) => ({ skill: 's', case: c, agent: 'claude', model, run_idx: i, passed: p, score: p ? 1 : 0, triggered: p, judge_dependent: false, latency_ms: 0, ...(error ? { error: 'x' } : {}) }));
const k = (pass: number, n: number) => Array.from({ length: n }, (_, i) => i < pass);

it('pRegressed is symmetric and monotone', () => {
  expect(pRegressed(5, 5, 5, 5)).toBeCloseTo(0.5);
  expect(pRegressed(5, 5, 2, 5)).toBeGreaterThan(0.95);
  expect(pRegressed(2, 5, 5, 5)).toBeCloseTo(1 - pRegressed(5, 5, 2, 5));
});

it.each([
  [5, 2, 'REGRESSED'], [5, 5, 'UNCHANGED'], [5, 4, 'UNCHANGED'], [5, 3, 'INCONCLUSIVE'], [2, 5, 'IMPROVED'],
])('5/5 vs %i/5 → %s', (o, n, v) => {
  expect(toVerdict(pRegressed(o, 5, n, 5))).toBe(v);
});

it('compareSkill: worst case wins, error runs excluded', () => {
  const sv = compareSkill('s', [
    ...runs('old', 'a', k(5, 5)), ...runs('new', 'a', k(5, 5)),
    ...runs('old', 'b', k(5, 5)), ...runs('new', 'b', k(2, 5)), ...runs('new', 'b', k(1, 1), true),
  ], 'old', 'new');
  expect(sv.verdict).toBe('REGRESSED');
  expect(sv.cases.map((c) => c.verdict)).toEqual(['UNCHANGED', 'REGRESSED']);
  expect(sv.cases[1].new).toEqual({ passed: 2, runs: 5, errors: 1 });
  expect(sv.aggregate).toEqual({ old_pass_rate: 1, new_pass_rate: 0.7 });
});
