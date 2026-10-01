import type { RunResult } from '../runner/types.js';
import { pRegressed } from './beta.js';

export type CaseVerdict = 'REGRESSED' | 'IMPROVED' | 'UNCHANGED' | 'INCONCLUSIVE';
export type InternalVerdict = CaseVerdict | 'AMBIGUOUS';
export type SkillVerdict = CaseVerdict;

export interface Tally { passed: number; runs: number; errors: number }
export interface TriggerCaseComparison { name: string; expected: boolean; verdict: CaseVerdict; needsMoreRuns: boolean; old: Tally; new: Tally; p_reg: number }
export interface TriggerMetrics { precision: number | null; recall: number | null; true_positives: number; false_positives: number; false_negatives: number; true_negatives: number; runs: number; errors: number }
export interface TriggerComparison { old: TriggerMetrics; new: TriggerMetrics; verdict: SkillVerdict; p_reg: number; cases: TriggerCaseComparison[] }
export interface CaseComparison { name: string; tags: string[]; verdict: CaseVerdict; needsMoreRuns: boolean; judge_dependent: boolean; old: Tally; new: Tally; p_reg: number; evidence: Evidence[] }
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

function tally(rs: RunResult[]): Tally {
  const ok = rs.filter((r) => !r.error);
  return { passed: ok.filter((r) => r.passed).length, runs: ok.length, errors: rs.length - ok.length };
}

function triggerExpectation(name: string, tags: string[]): boolean | undefined {
  const shouldTrigger = tags.includes('trigger');
  const shouldNotTrigger = tags.includes('no-trigger');
  if (shouldTrigger && shouldNotTrigger) {
    throw new Error(`case "${name}" cannot have both trigger and no-trigger tags`);
  }
  return shouldTrigger ? true : shouldNotTrigger ? false : undefined;
}

function triggerTally(rs: RunResult[], expected: boolean): Tally {
  const ok = rs.filter((r) => !r.error);
  return { passed: ok.filter((r) => r.triggered === expected).length, runs: ok.length, errors: rs.length - ok.length };
}

function compareTriggerCase(name: string, expected: boolean, olds: RunResult[], news: RunResult[]): TriggerCaseComparison {
  const old = triggerTally(olds, expected), newer = triggerTally(news, expected);
  const conclusive = old.runs > 0 && newer.runs > 0;
  const p = conclusive ? pRegressed(old.passed, old.runs, newer.passed, newer.runs) : 0.5;
  const internalVerdict = conclusive ? toInternalVerdict(p) : 'INCONCLUSIVE';
  return {
    name, expected,
    verdict: internalVerdict === 'AMBIGUOUS' ? 'INCONCLUSIVE' : internalVerdict,
    needsMoreRuns: internalVerdict === 'AMBIGUOUS',
    old, new: newer, p_reg: p,
  };
}

function triggerMetrics(rs: RunResult[], expectations: Map<string, boolean>): TriggerMetrics {
  const relevant = rs.filter((r) => expectations.has(r.case));
  const valid = relevant.filter((r) => !r.error);
  let true_positives = 0, false_positives = 0, false_negatives = 0, true_negatives = 0;
  for (const result of valid) {
    const expected = expectations.get(result.case);
    if (expected === undefined) continue;
    if (expected && result.triggered) true_positives++;
    else if (!expected && result.triggered) false_positives++;
    else if (expected) false_negatives++;
    else true_negatives++;
  }
  const predictedPositive = true_positives + false_positives;
  const actualPositive = true_positives + false_negatives;
  return {
    precision: predictedPositive ? true_positives / predictedPositive : null,
    recall: actualPositive ? true_positives / actualPositive : null,
    true_positives, false_positives, false_negatives, true_negatives,
    runs: valid.length, errors: relevant.length - valid.length,
  };
}

function verdictForCases(cases: { verdict: CaseVerdict }[]): SkillVerdict {
  const has = (v: CaseVerdict) => cases.some((c) => c.verdict === v);
  return has('REGRESSED') ? 'REGRESSED' : has('INCONCLUSIVE') ? 'INCONCLUSIVE' : has('IMPROVED') ? 'IMPROVED' : 'UNCHANGED';
}

export function compareCase(name: string, olds: RunResult[], news: RunResult[], tags: string[] = []): CaseComparison {
  const o = tally(olds), n = tally(news);
  const conclusive = o.runs > 0 && n.runs > 0;
  const p = conclusive ? pRegressed(o.passed, o.runs, n.passed, n.runs) : 0.5;
  const internalVerdict = conclusive ? toInternalVerdict(p) : 'INCONCLUSIVE';
  return {
    name, tags, verdict: internalVerdict === 'AMBIGUOUS' ? 'INCONCLUSIVE' : internalVerdict,
    needsMoreRuns: internalVerdict === 'AMBIGUOUS',
    judge_dependent: [...olds, ...news].some((r) => r.judge_dependent),
    old: o, new: n, p_reg: p,
    evidence: news.filter((r) => !r.error && !r.passed).slice(0, 2).map((r) => ({ run_idx: r.run_idx, failed_assertions: r.failed_assertions ?? [], excerpt: r.excerpt ?? '' })),
  };
}

export function compareSkill(skill: string, olds: RunResult[], news: RunResult[], tagsOf: (c: string) => string[] = () => []): SkillComparison {
  const names = [...new Set([...olds, ...news].map((r) => r.case))];
  const expectations = new Map<string, boolean>();
  for (const name of names) {
    const expected = triggerExpectation(name, tagsOf(name));
    if (expected !== undefined) expectations.set(name, expected);
  }
  const triggerCases = [...expectations].map(([name, expected]) => compareTriggerCase(
    name, expected, olds.filter((r) => r.case === name), news.filter((r) => r.case === name),
  ));
  const trigger = triggerCases.length ? {
    old: triggerMetrics(olds, expectations),
    new: triggerMetrics(news, expectations),
    verdict: verdictForCases(triggerCases),
    p_reg: (() => {
      const old = triggerCases.reduce((sum, c) => ({ passed: sum.passed + c.old.passed, runs: sum.runs + c.old.runs }), { passed: 0, runs: 0 });
      const newer = triggerCases.reduce((sum, c) => ({ passed: sum.passed + c.new.passed, runs: sum.runs + c.new.runs }), { passed: 0, runs: 0 });
      return old.runs && newer.runs ? pRegressed(old.passed, old.runs, newer.passed, newer.runs) : 0.5;
    })(),
    cases: triggerCases,
  } : null;
  const triggerByName = new Map(triggerCases.map((c) => [c.name, c]));
  const cases = names.map((c) => {
    const comparison = compareCase(c, olds.filter((r) => r.case === c), news.filter((r) => r.case === c), tagsOf(c));
    comparison.needsMoreRuns ||= triggerByName.get(c)?.needsMoreRuns ?? false;
    return comparison;
  });
  const caseVerdict = verdictForCases(cases);
  const verdict: SkillVerdict = trigger?.verdict === 'REGRESSED' || caseVerdict === 'REGRESSED' ? 'REGRESSED'
    : trigger?.verdict === 'INCONCLUSIVE' || caseVerdict === 'INCONCLUSIVE' ? 'INCONCLUSIVE'
    : trigger?.verdict === 'IMPROVED' || caseVerdict === 'IMPROVED' ? 'IMPROVED'
    : 'UNCHANGED';
  const rate = (k: 'old' | 'new') => { const runs = cases.reduce((s, c) => s + c[k].runs, 0); return runs ? cases.reduce((s, c) => s + c[k].passed, 0) / runs : 0; };
  return { name: skill, verdict, aggregate: { old_pass_rate: rate('old'), new_pass_rate: rate('new') }, trigger, cases };
}
