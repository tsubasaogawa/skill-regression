import { expect, it } from 'vitest';
import { exitCode, isLowPower, skillFlags, toMarkdown, buildReport, type SkillReport } from '../src/reporter/report.js';
import type { CaseComparison } from '../src/comparator/verdict.js';

const c = (verdict: CaseComparison['verdict'], judge = false, errors = 0): CaseComparison =>
  ({ name: 'c', tags: [], verdict, needsMoreRuns: false, judge_dependent: judge, old: { passed: 5, runs: 5, errors: 0 }, new: { passed: 2, runs: 5, errors }, p_reg: 0.97, evidence: [{ run_idx: 0, failed_assertions: ['skill-used'], excerpt: 'out' }] });
const s = (cases: CaseComparison[], source: 'evals.json' | 'generated' = 'evals.json'): SkillReport => {
  const base = { name: 's', verdict: cases[0].verdict, aggregate: { old_pass_rate: 1, new_pass_rate: 0.4 }, trigger: null, cases, flags: [] as SkillReport['flags'], cases_source: source, cases_hash: 'h' };
  return { ...base, flags: skillFlags(base, source) };
};

it('exit code: 1 only for deterministic regressions, 2 for inconclusive/partial', () => {
  expect(exitCode([s([c('REGRESSED')])])).toBe(1);
  expect(exitCode([s([c('REGRESSED', true)])])).toBe(0);
  expect(exitCode([s([c('INCONCLUSIVE')])])).toBe(2);
  expect(exitCode([s([c('UNCHANGED', false, 1)])])).toBe(2);
  expect(exitCode([{ ...s([c('UNCHANGED')]), verdict: 'DEGRADED' }])).toBe(2);
  expect(exitCode([s([c('UNCHANGED')])])).toBe(0);
});

it('flags and markdown', () => {
  const sr = s([c('REGRESSED', true, 1)], 'generated');
  expect(sr.flags).toEqual(['generated-cases', 'judge-dependent', 'partial']);
  const r = buildReport([sr], { old: [], new: [] }, { oldModel: 'a', newModel: 'b', startedAt: new Date() });
  expect(r.cost_usd.judge).toBeNull();
  expect(r.exit_code).toBe(2);
  const md = toMarkdown(r);
  expect(md).toContain('judge unavailable');
  expect(md).toContain('| s | REGRESSED | 100% | 40% | generated-cases, judge-dependent, partial |');
  expect(md).toContain('| c | REGRESSED | 5/5 | 2/5 | 0.97 | yes |');
  expect(md).toContain('failed skill-used');
});

it('sets exit code and renders trigger regressions', () => {
  const sr = s([c('UNCHANGED')]);
  sr.trigger = {
    old: { precision: 1, recall: 1, true_positives: 5, false_positives: 0, false_negatives: 0, true_negatives: 5, runs: 10, errors: 0 },
    new: { precision: 0.5, recall: 0.4, true_positives: 2, false_positives: 2, false_negatives: 3, true_negatives: 3, runs: 10, errors: 0 },
    verdict: 'REGRESSED',
    p_reg: 0.97,
    cases: [{ name: 'fires', expected: true, verdict: 'REGRESSED', needsMoreRuns: false, old: { passed: 5, runs: 5, errors: 0 }, new: { passed: 2, runs: 5, errors: 0 }, p_reg: 0.97 }],
  };
  expect(exitCode([sr])).toBe(1);
  const r = buildReport([sr], { old: [], new: [] }, { oldModel: 'a', newModel: 'b', startedAt: new Date() });
  const md = toMarkdown(r);
  expect(md).toContain('## Trigger precision / recall');
  expect(md).toContain('| s | REGRESSED | 100% | 50% | 100% | 40% | 0.97 |');
  expect(md).toContain('| s | fires | yes | REGRESSED | 5/5 | 2/5 | 0.97 |');
});

it('flags low power when a total failure could not have been detected', () => {
  const tally = (passed: number, runs: number) => ({ passed, runs, errors: 0 });
  expect(isLowPower({ old: tally(1, 1), new: tally(1, 1) })).toBe(true);
  expect(isLowPower({ old: tally(1, 2), new: tally(2, 2) })).toBe(true);
  expect(isLowPower({ old: tally(2, 2), new: tally(2, 2) })).toBe(false);
  expect(isLowPower({ old: tally(5, 5), new: tally(5, 5) })).toBe(false);
  const weak = { ...c('UNCHANGED'), old: tally(1, 1), new: tally(1, 1), p_reg: 0.5 };
  expect(s([weak]).flags).toEqual(['low-power']);
  expect(s([{ ...weak, verdict: 'INCONCLUSIVE' }]).flags).toEqual([]);
  expect(s([c('UNCHANGED')]).flags).toEqual([]);
});
