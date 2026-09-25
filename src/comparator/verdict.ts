import type { RunResult } from '../runner/types.js';
import { pRegressed } from './beta.js';

export type CaseVerdict = 'REGRESSED' | 'IMPROVED' | 'UNCHANGED' | 'INCONCLUSIVE';
export type SkillVerdict = CaseVerdict;

export interface Tally { passed: number; runs: number; errors: number }
export interface CaseComparison { name: string; tags: string[]; verdict: CaseVerdict; judge_dependent: boolean; old: Tally; new: Tally; p_reg: number; evidence: Evidence[] }
export interface Evidence { run_idx: number; failed_assertions: string[]; excerpt: string }
export interface SkillComparison { name: string; verdict: SkillVerdict; aggregate: { old_pass_rate: number; new_pass_rate: number }; cases: CaseComparison[] }

// ponytail: no additional-run loop, so the design's AMBIGUOUS band (0.80-0.95) collapses straight to INCONCLUSIVE
export function toVerdict(p: number): CaseVerdict {
  if (p >= 0.95) return 'REGRESSED';
  if (p <= 0.05) return 'IMPROVED';
  return p >= 0.8 ? 'INCONCLUSIVE' : 'UNCHANGED';
}

function tally(rs: RunResult[]): Tally {
  const ok = rs.filter((r) => !r.error);
  return { passed: ok.filter((r) => r.passed).length, runs: ok.length, errors: rs.length - ok.length };
}

export function compareCase(name: string, olds: RunResult[], news: RunResult[], tags: string[] = []): CaseComparison {
  const o = tally(olds), n = tally(news);
  const conclusive = o.runs > 0 && n.runs > 0;
  const p = conclusive ? pRegressed(o.passed, o.runs, n.passed, n.runs) : 0.5;
  return {
    name, tags, verdict: conclusive ? toVerdict(p) : 'INCONCLUSIVE',
    judge_dependent: [...olds, ...news].some((r) => r.judge_dependent),
    old: o, new: n, p_reg: p,
    evidence: news.filter((r) => !r.error && !r.passed).slice(0, 2).map((r) => ({ run_idx: r.run_idx, failed_assertions: r.failed_assertions ?? [], excerpt: r.excerpt ?? '' })),
  };
}

export function compareSkill(skill: string, results: RunResult[], oldModel: string, newModel: string, tagsOf: (c: string) => string[] = () => []): SkillComparison {
  const names = [...new Set(results.map((r) => r.case))];
  const cases = names.map((c) => compareCase(c,
    results.filter((r) => r.case === c && r.model === oldModel),
    results.filter((r) => r.case === c && r.model === newModel), tagsOf(c)));
  const has = (v: CaseVerdict) => cases.some((c) => c.verdict === v);
  const verdict: SkillVerdict = has('REGRESSED') ? 'REGRESSED' : has('INCONCLUSIVE') ? 'INCONCLUSIVE' : has('IMPROVED') ? 'IMPROVED' : 'UNCHANGED';
  const rate = (k: 'old' | 'new') => { const runs = cases.reduce((s, c) => s + c[k].runs, 0); return runs ? cases.reduce((s, c) => s + c[k].passed, 0) / runs : 0; };
  return { name: skill, verdict, aggregate: { old_pass_rate: rate('old'), new_pass_rate: rate('new') }, cases };
}
