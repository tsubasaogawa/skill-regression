import { expect, it } from 'vitest';
import { exitCode, skillFlags, toMarkdown, buildReport, type SkillReport } from '../src/reporter/report.js';
import type { CaseComparison } from '../src/comparator/verdict.js';

const c = (verdict: CaseComparison['verdict'], judge = false, errors = 0): CaseComparison =>
  ({ name: 'c', tags: [], verdict, judge_dependent: judge, old: { passed: 5, runs: 5, errors: 0 }, new: { passed: 2, runs: 5, errors }, p_reg: 0.97, evidence: [{ run_idx: 0, failed_assertions: ['skill-used'], excerpt: 'out' }] });
const s = (cases: CaseComparison[], source: 'evals.json' | 'generated' = 'evals.json'): SkillReport => {
  const base = { name: 's', verdict: cases[0].verdict, aggregate: { old_pass_rate: 1, new_pass_rate: 0.4 }, cases, flags: [] as SkillReport['flags'], cases_source: source, cases_hash: 'h' };
  return { ...base, flags: skillFlags(base, source) };
};

it('exit code: 1 only for deterministic regressions, 2 for inconclusive/partial', () => {
  expect(exitCode([s([c('REGRESSED')])])).toBe(1);
  expect(exitCode([s([c('REGRESSED', true)])])).toBe(0);
  expect(exitCode([s([c('INCONCLUSIVE')])])).toBe(2);
  expect(exitCode([s([c('UNCHANGED', false, 1)])])).toBe(2);
  expect(exitCode([s([c('UNCHANGED')])])).toBe(0);
});

it('flags and markdown', () => {
  const sr = s([c('REGRESSED', true, 1)], 'generated');
  expect(sr.flags).toEqual(['generated-cases', 'judge-dependent', 'partial']);
  const r = buildReport([sr], [], { oldModel: 'a', newModel: 'b', startedAt: new Date() });
  expect(r.exit_code).toBe(2);
  const md = toMarkdown(r);
  expect(md).toContain('| s | REGRESSED | 100% | 40% | generated-cases, judge-dependent, partial |');
  expect(md).toContain('| c | REGRESSED | 5/5 | 2/5 | 0.97 | yes |');
  expect(md).toContain('failed skill-used');
});
