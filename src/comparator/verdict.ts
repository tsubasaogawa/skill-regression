import type { RunResult } from '../runner/types.js';
import { pRegressed } from './beta.js';

export type Verdict = 'REGRESSED' | 'IMPROVED' | 'UNCHANGED' | 'AMBIGUOUS';

export interface Tally { pass: number; n: number; errors: number }
export interface CaseVerdict { case: string; old: Tally; new: Tally; p_regressed: number; verdict: Verdict; judge_dependent: boolean }
export interface SkillVerdict { skill: string; verdict: Verdict; cases: CaseVerdict[] }

export function toVerdict(p: number): Verdict {
  if (p >= 0.9) return 'REGRESSED';
  if (p <= 0.1) return 'IMPROVED';
  return p >= 0.25 && p <= 0.75 ? 'UNCHANGED' : 'AMBIGUOUS';
}

function tally(rs: RunResult[]): Tally {
  const ok = rs.filter((r) => !r.error);
  return { pass: ok.filter((r) => r.passed).length, n: ok.length, errors: rs.length - ok.length };
}

export function compareCase(name: string, olds: RunResult[], news: RunResult[]): CaseVerdict {
  const o = tally(olds), n = tally(news);
  const p = o.n && n.n ? pRegressed(o.pass, o.n, n.pass, n.n) : 0.5;
  return { case: name, old: o, new: n, p_regressed: p, verdict: o.n && n.n ? toVerdict(p) : 'AMBIGUOUS', judge_dependent: [...olds, ...news].some((r) => r.judge_dependent) };
}

export function compareSkill(skill: string, results: RunResult[], oldModel: string, newModel: string): SkillVerdict {
  const names = [...new Set(results.map((r) => r.case))];
  const cases = names.map((c) => compareCase(c,
    results.filter((r) => r.case === c && r.model === oldModel),
    results.filter((r) => r.case === c && r.model === newModel)));
  const has = (v: Verdict) => cases.some((c) => c.verdict === v);
  const verdict: Verdict = has('REGRESSED') ? 'REGRESSED' : has('AMBIGUOUS') ? 'AMBIGUOUS' : has('IMPROVED') ? 'IMPROVED' : 'UNCHANGED';
  return { skill, verdict, cases };
}
