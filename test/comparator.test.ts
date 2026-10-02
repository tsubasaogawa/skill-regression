import { expect, it } from 'vitest';
import { pRegressed } from '../src/comparator/beta.js';
import { compareCase, compareSkill, toInternalVerdict, toVerdict } from '../src/comparator/verdict.js';
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

it('distinguishes the internal ambiguous band', () => {
  expect(toInternalVerdict(0.85)).toBe('AMBIGUOUS');
  expect(toInternalVerdict(0.96)).toBe('REGRESSED');
  expect(toInternalVerdict(0.70)).toBe('UNCHANGED');
});

it('requests more runs for an ambiguous case', () => {
  const comparison = compareCase('a', runs('old', 'a', k(5, 5)), runs('new', 'a', k(3, 5)));
  expect(comparison.verdict).toBe('INCONCLUSIVE');
  expect(comparison.needsMoreRuns).toBe(true);
});

it('can resolve an ambiguous case as regressed with more runs', () => {
  const initialOld = runs('old', 'a', k(5, 5));
  const initialNew = runs('new', 'a', k(3, 5));
  const resolved = compareCase('a', [...initialOld, ...runs('old', 'a', k(5, 5))], [...initialNew, ...runs('new', 'a', k(0, 5))]);
  expect(compareCase('a', initialOld, initialNew).needsMoreRuns).toBe(true);
  expect(resolved.verdict).toBe('REGRESSED');
  expect(resolved.needsMoreRuns).toBe(false);
});

it('can resolve an ambiguous case as unchanged with more runs', () => {
  const initialOld = runs('old', 'a', k(5, 5));
  const initialNew = runs('new', 'a', k(3, 5));
  const resolved = compareCase('a', [...initialOld, ...runs('old', 'a', k(4, 5))], [...initialNew, ...runs('new', 'a', k(5, 5))]);
  expect(resolved.verdict).toBe('UNCHANGED');
  expect(resolved.needsMoreRuns).toBe(false);
});

it('compareSkill: worst case wins, error runs excluded', () => {
  const sv = compareSkill('s',
    [...runs('old', 'a', k(5, 5)), ...runs('old', 'b', k(5, 5))],
    [...runs('new', 'a', k(5, 5)), ...runs('new', 'b', k(2, 5)), ...runs('new', 'b', k(1, 1), true)]);
  expect(sv.verdict).toBe('REGRESSED');
  expect(sv.cases.map((c) => c.verdict)).toEqual(['UNCHANGED', 'REGRESSED']);
  expect(sv.cases[1].new).toEqual({ passed: 2, runs: 5, errors: 1 });
  expect(sv.aggregate).toEqual({ old_pass_rate: 1, new_pass_rate: 0.7 });
});

it('reports trigger precision and recall and prioritizes trigger regressions', () => {
  const oldTrigger = runs('old', 'should-trigger', k(5, 5));
  const newTrigger = runs('new', 'should-trigger', k(5, 5)).map((r, i) => ({ ...r, triggered: i < 2 }));
  const oldNoTrigger = runs('old', 'should-not-trigger', k(5, 5)).map((r) => ({ ...r, triggered: false }));
  const newNoTrigger = runs('new', 'should-not-trigger', k(5, 5)).map((r, i) => ({ ...r, triggered: i < 2 }));
  const comparison = compareSkill(
    's',
    [...oldTrigger, ...oldNoTrigger],
    [...newTrigger, ...newNoTrigger],
    (name) => name === 'should-trigger' ? ['trigger'] : name === 'should-not-trigger' ? ['no-trigger'] : ['quality'],
  );

  expect(comparison.trigger?.old).toMatchObject({ precision: 1, recall: 1, true_positives: 5, true_negatives: 5 });
  expect(comparison.trigger?.new).toMatchObject({ precision: 0.5, recall: 0.4, true_positives: 2, false_positives: 2, false_negatives: 3, true_negatives: 3 });
  expect(comparison.trigger?.verdict).toBe('REGRESSED');
  expect(comparison.verdict).toBe('REGRESSED');
  expect(comparison.aggregate).toEqual({ old_pass_rate: 1, new_pass_rate: 1 });
});

it('requests more runs when trigger correctness is ambiguous and omits metrics without trigger tags', () => {
  const old = runs('old', 'should-not-trigger', k(5, 5)).map((r) => ({ ...r, triggered: false }));
  const newer = runs('new', 'should-not-trigger', k(5, 5)).map((r, i) => ({ ...r, triggered: i < 2 }));
  const comparison = compareSkill('s', old, newer, () => ['no-trigger']);
  expect(comparison.cases[0].verdict).toBe('UNCHANGED');
  expect(comparison.cases[0].needsMoreRuns).toBe(true);
  expect(comparison.trigger?.cases[0].verdict).toBe('INCONCLUSIVE');
  expect(compareSkill('s', old, newer).trigger).toBeNull();
});

it('excludes error runs and reports undefined precision when there are no predicted positives', () => {
  const results = [
    ...runs('new', 'should-trigger', k(5, 5)).map((r) => ({ ...r, triggered: false })),
    ...runs('new', 'should-not-trigger', k(5, 5)).map((r) => ({ ...r, triggered: false })),
    ...runs('new', 'should-trigger', [false], true).map((r) => ({ ...r, triggered: true })),
  ];
  const comparison = compareSkill('s', [], results, (name) =>
    name === 'should-trigger' ? ['trigger'] : ['no-trigger']);
  expect(comparison.trigger?.new).toEqual({
    precision: null, recall: 0, true_positives: 0, false_positives: 0,
    false_negatives: 5, true_negatives: 5, runs: 10, errors: 1,
  });
});

it('rejects cases tagged as both trigger and no-trigger', () => {
  expect(() => compareSkill('s', runs('old', 'invalid', [true]), [], () => ['trigger', 'no-trigger']))
    .toThrow('cannot have both trigger and no-trigger tags');
});

it('marks a skill DEGRADED when the aggregate pass rate drops by the threshold without a regressed case', () => {
  const olds = [...runs('old', 'a', k(5, 5)), ...runs('old', 'b', k(5, 5))];
  const news = [...runs('new', 'a', k(4, 5)), ...runs('new', 'b', k(4, 5))];
  expect(compareSkill('s', olds, news).verdict).toBe('UNCHANGED');
  expect(compareSkill('s', olds, news, () => [], 0.2).verdict).toBe('DEGRADED');
  expect(compareSkill('s', olds, news, () => [], 0.25).verdict).toBe('UNCHANGED');
  expect(compareSkill('s', olds, [...runs('new', 'a', k(4, 5)), ...runs('new', 'b', k(1, 5))], () => [], 0.2).verdict).toBe('REGRESSED');
});
