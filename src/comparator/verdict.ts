import type { RunResult } from '../runner/types.js';
import { pRegressed } from './beta.js';

export type CaseVerdict = 'REGRESSED' | 'IMPROVED' | 'UNCHANGED' | 'INCONCLUSIVE';
export type InternalVerdict = CaseVerdict | 'AMBIGUOUS';
export type SkillVerdict = CaseVerdict | 'DEGRADED';

export interface Tally { passed: number; runs: number; errors: number }
export interface TriggerCaseComparison { name: string; expected: boolean; verdict: CaseVerdict; needsMoreRuns: boolean; old: Tally; new: Tally; p_reg: number }
export interface TriggerMetrics { precision: number | null; recall: number | null; true_positives: number; false_positives: number; false_negatives: number; true_negatives: number; runs: number; errors: number }
export interface MetricComparison { old: Tally; new: Tally; verdict: CaseVerdict; needsMoreRuns: boolean; p_reg: number }
export interface TriggerComparison { old: TriggerMetrics; new: TriggerMetrics; verdict: SkillVerdict; p_reg: number; cases: TriggerCaseComparison[]; precision?: MetricComparison | null; recall?: MetricComparison | null }
export interface CaseComparison { name: string; tags: string[]; verdict: CaseVerdict; needsMoreRuns: boolean; judge_dependent: boolean; old: Tally; new: Tally; p_reg: number; evidence: Evidence[]; deterministic?: MetricComparison }
export interface Evidence { run_idx: number; failed_assertions: string[]; excerpt: string }
export interface SkillComparison { name: string; verdict: SkillVerdict; aggregate: { old_pass_rate: number; new_pass_rate: number }; trigger: TriggerComparison | null; cases: CaseComparison[] }

export function toInternalVerdict(p: number): InternalVerdict {
  if (p >= 0.95) return 'REGRESSED';
  if (p <= 0.05) return 'IMPROVED';
  return p >= 0.8 ? 'AMBIGUOUS' : 'UNCHANGED';
}

export function toVerdict(p: number): CaseVerdict {
  const verdict = toInternalVerdict(p);
  return verdict === 'AMBIGUOUS' ? 'INCONCLUSIVE' : verdict;
}

/** Most severe verdict wins. */
const SEVERITY: SkillVerdict[] = ['REGRESSED', 'DEGRADED', 'INCONCLUSIVE', 'IMPROVED', 'UNCHANGED'];
const worst = (verdicts: SkillVerdict[]): SkillVerdict => SEVERITY.find((v) => verdicts.includes(v)) ?? 'UNCHANGED';

function tally(rs: RunResult[], passed: (r: RunResult) => boolean): Tally {
  const ok = rs.filter((r) => !r.error);
  return { passed: ok.filter(passed).length, runs: ok.length, errors: rs.length - ok.length };
}

function judge(old: Tally, newer: Tally): { verdict: CaseVerdict; needsMoreRuns: boolean; p_reg: number } {
  if (!old.runs || !newer.runs) return { verdict: 'INCONCLUSIVE', needsMoreRuns: false, p_reg: 0.5 };
  const p_reg = pRegressed(old.passed, old.runs, newer.passed, newer.runs);
  return { verdict: toVerdict(p_reg), needsMoreRuns: toInternalVerdict(p_reg) === 'AMBIGUOUS', p_reg };
}

function triggerExpectation(name: string, tags: string[]): boolean | undefined {
  const shouldTrigger = tags.includes('trigger');
  const shouldNotTrigger = tags.includes('no-trigger');
  if (shouldTrigger && shouldNotTrigger) throw new Error(`case "${name}" cannot have both trigger and no-trigger tags`);
  return shouldTrigger ? true : shouldNotTrigger ? false : undefined;
}

function triggerMetrics(rs: RunResult[], expectations: Map<string, boolean>): TriggerMetrics {
  const relevant = rs.filter((r) => expectations.has(r.case));
  const valid = relevant.filter((r) => !r.error);
  const count = (expected: boolean, triggered: boolean) => valid.filter((r) => expectations.get(r.case) === expected && r.triggered === triggered).length;
  const true_positives = count(true, true), false_positives = count(false, true), false_negatives = count(true, false), true_negatives = count(false, false);
  const ratio = (n: number, d: number) => d ? n / d : null;
  return {
    precision: ratio(true_positives, true_positives + false_positives),
    recall: ratio(true_positives, true_positives + false_negatives),
    true_positives, false_positives, false_negatives, true_negatives,
    runs: valid.length, errors: relevant.length - valid.length,
  };
}

export function compareCase(name: string, olds: RunResult[], news: RunResult[], tags: string[] = []): CaseComparison {
  const o = tally(olds, (r) => r.passed), n = tally(news, (r) => r.passed);
  const detPassed = (r: RunResult) => r.deterministic_passed ?? (!r.judge_dependent && r.passed);
  const deterministicOld = tally(olds, detPassed), deterministicNew = tally(news, detPassed);
  const hasDeterministic = [...olds, ...news].every((r) => r.error || r.deterministic_passed !== undefined || !r.judge_dependent);
  const deterministic = hasDeterministic ? { old: deterministicOld, new: deterministicNew, ...judge(deterministicOld, deterministicNew) } : undefined;
  const overall = judge(o, n);
  return {
    name, tags, ...overall,
    verdict: worst([overall.verdict, ...(deterministic ? [deterministic.verdict] : [])]) as CaseVerdict,
    needsMoreRuns: overall.needsMoreRuns || !!deterministic?.needsMoreRuns,
    ...(deterministic ? { deterministic } : {}),
    judge_dependent: [...olds, ...news].some((r) => r.judge_dependent),
    old: o, new: n,
    evidence: news.filter((r) => !r.error && !r.passed).slice(0, 2).map((r) => ({ run_idx: r.run_idx, failed_assertions: r.failed_assertions ?? [], excerpt: r.excerpt ?? '' })),
  };
}

function compareTrigger(names: string[], olds: RunResult[], news: RunResult[], tagsOf: (c: string) => string[]): TriggerComparison | null {
  const expectations = new Map<string, boolean>();
  for (const name of names) {
    const expected = triggerExpectation(name, tagsOf(name));
    if (expected !== undefined) expectations.set(name, expected);
  }
  if (!expectations.size) return null;
  const cases = [...expectations].map(([name, expected]): TriggerCaseComparison => {
    const correct = (r: RunResult) => r.triggered === expected;
    const old = tally(olds.filter((r) => r.case === name), correct), newer = tally(news.filter((r) => r.case === name), correct);
    return { name, expected, ...judge(old, newer), old, new: newer };
  });
  const old = triggerMetrics(olds, expectations), newer = triggerMetrics(news, expectations);
  const metric = (kind: 'precision' | 'recall'): MetricComparison | null => {
    const counts = (m: TriggerMetrics): Tally => ({
      passed: m.true_positives,
      runs: m.true_positives + (kind === 'precision' ? m.false_positives : m.false_negatives),
      errors: m.errors,
    });
    const o = counts(old), n = counts(newer);
    // A metric with no observations on either side cannot be compared.
    return !o.runs || !n.runs ? null : { old: o, new: n, ...judge(o, n) };
  };
  const precision = metric('precision'), recall = metric('recall');
  const metrics = [precision, recall].filter((m): m is MetricComparison => m !== null);
  return {
    old, new: newer, precision, recall,
    verdict: worst([...cases.map((c) => c.verdict), ...metrics.map((m) => m.verdict)]),
    p_reg: metrics.length ? Math.max(...metrics.map((m) => m.p_reg)) : 0.5, cases,
  };
}

export function compareSkill(skill: string, olds: RunResult[], news: RunResult[], tagsOf: (c: string) => string[] = () => [], aggregateDropPt?: number): SkillComparison {
  const names = [...new Set([...olds, ...news].map((r) => r.case))];
  const trigger = compareTrigger(names, olds, news, tagsOf);
  const cases = names.map((name) => {
    const comparison = compareCase(name, olds.filter((r) => r.case === name), news.filter((r) => r.case === name), tagsOf(name));
    const tc = trigger?.cases.find((c) => c.name === name);
    if (tc) comparison.needsMoreRuns ||= tc.needsMoreRuns || !!trigger?.precision?.needsMoreRuns || !!trigger?.recall?.needsMoreRuns;
    return comparison;
  });
  const rate = (side: 'old' | 'new') => {
    const runs = cases.reduce((s, c) => s + c[side].runs, 0);
    return runs ? cases.reduce((s, c) => s + c[side].passed, 0) / runs : 0;
  };
  const aggregate = { old_pass_rate: rate('old'), new_pass_rate: rate('new') };
  const degraded = aggregateDropPt !== undefined && aggregate.old_pass_rate - aggregate.new_pass_rate >= aggregateDropPt - 1e-9;
  const verdict = worst([...cases.map((c) => c.verdict), ...(trigger ? [trigger.verdict] : []), ...(degraded ? ['DEGRADED' as const] : [])]);
  return { name: skill, verdict, aggregate, trigger, cases };
}
