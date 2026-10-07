import { createRequire } from 'node:module';
import { pRegressed } from '../comparator/beta.js';
import type { CaseComparison, SkillComparison } from '../comparator/verdict.js';
import type { CaseSource } from '../cases/load.js';
import type { RunResult } from '../runner/types.js';

const require = createRequire(import.meta.url);
export const VERSION: string = require('../../package.json').version;

export type Flag = 'generated-cases' | 'judge-dependent' | 'low-power' | 'has-errors';

const FLAG_LEGEND: Record<Flag, string> = {
  'generated-cases': 'cases came from the generator, so confidence is lower than hand-written cases',
  'judge-dependent': 'a verdict rests on llm_rubric and is report-only',
  'low-power': 'too few runs: UNCHANGED does not mean no regression',
  'has-errors': 'some runs errored and were excluded',
};
export interface SkillReport extends SkillComparison { flags: Flag[]; cases_source: CaseSource; cases_hash: string }
export interface Report {
  skilldrift_version: string; promptfoo_version: string; agent: string;
  old_model: string; new_model: string; claude_version?: string;
  started_at: string; finished_at: string;
  cost_usd: { old: number; new: number; judge: number | null };
  exit_code: number; skills: SkillReport[]; skipped_skills?: string[];
}

/** True when even zero new-model passes could not reach REGRESSED, so an UNCHANGED verdict proves nothing. */
export function isLowPower(c: Pick<CaseComparison, 'old' | 'new'>): boolean {
  return !c.old.runs || !c.new.runs || pRegressed(c.old.passed, c.old.runs, 0, c.new.runs) < 0.95;
}

export function skillFlags(sc: SkillComparison, source: CaseSource): Flag[] {
  const f: Flag[] = [];
  if (source === 'generated') f.push('generated-cases');
  if (sc.cases.some((c) => c.judge_dependent)) f.push('judge-dependent');
  if (sc.cases.some((c) => c.verdict === 'UNCHANGED' && isLowPower(c))) f.push('low-power');
  if (sc.cases.some((c) => c.old.errors + c.new.errors > 0)) f.push('has-errors');
  return f;
}

/** 0 = no regression, 1 = regression on a deterministic case, 2 = degraded, inconclusive, has-errors or skipped. Judge-dependent regressions are report-only. */
export function exitCode(skills: SkillReport[], skipped: string[] = []): number {
  const cases = skills.flatMap((s) => s.cases);
  if (cases.some((c) => c.deterministic?.verdict === 'REGRESSED' || (c.verdict === 'REGRESSED' && !c.judge_dependent))
    || skills.some((s) => s.trigger?.verdict === 'REGRESSED')) return 1;
  if (cases.some((c) => c.verdict === 'INCONCLUSIVE' || c.deterministic?.verdict === 'INCONCLUSIVE')
    || skipped.length
    || skills.some((s) => s.verdict === 'DEGRADED' || s.trigger?.verdict === 'INCONCLUSIVE' || s.flags.includes('has-errors'))) return 2;
  return 0;
}

export const totalCost = (rs: RunResult[]): number => rs.reduce((s, r) => s + (r.cost_usd ?? 0), 0);

export function buildReport(skills: SkillReport[], results: { old: RunResult[]; new: RunResult[] }, o: { oldModel: string; newModel: string; startedAt: Date; claudeVersion?: string; skipped?: string[] }): Report {
  return {
    skilldrift_version: VERSION,
    promptfoo_version: require(require.resolve('promptfoo').replace(/dist[\/].*$/, 'package.json')).version,
    agent: 'claude', old_model: o.oldModel, new_model: o.newModel,
    ...(o.claudeVersion ? { claude_version: o.claudeVersion } : {}),
    started_at: o.startedAt.toISOString(), finished_at: new Date().toISOString(),
    cost_usd: { old: totalCost(results.old), new: totalCost(results.new), judge: null },
    exit_code: exitCode(skills, o.skipped), skills,
    ...(o.skipped?.length ? { skipped_skills: o.skipped } : {}),
  };
}

export const pct = (x?: number | null) => x == null ? 'n/a' : `${Math.round(x * 100)}%`;

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const width = (s: string) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);

/** Markdown table with columns padded to equal width; falls back to one block per row when wider than maxWidth. */
export function table(header: string[], rows: string[][], maxWidth = Infinity): string[] {
  const w = header.map((h, i) => Math.max(3, width(h), ...rows.map((r) => width(r[i] ?? ''))));
  if (w.reduce((n, x) => n + x + 3, 1) <= maxWidth) {
    const line = (cells: string[]) => `| ${cells.map((c, i) => c + ' '.repeat(w[i] - width(c))).join(' | ')} |`;
    return [line(header), line(w.map((n) => '-'.repeat(n))), ...rows.map(line)];
  }
  const kw = Math.max(...header.map(width));
  return rows.flatMap((r, ri) => [
    ...(ri ? [''] : []),
    ...header.flatMap((h, i) => r[i] ? [`${i ? '  ' : '- '}${h}:${' '.repeat(kw - width(h) + 1)}${r[i]}`] : []),
  ]);
}

export function toMarkdown(r: Report, maxWidth?: number): string {
  const judgeCost = r.cost_usd.judge == null ? 'unavailable' : `$${r.cost_usd.judge.toFixed(2)}`;
  const lines = [
    `# skilldrift: ${r.old_model} → ${r.new_model}`, '',
    ...(r.skipped_skills?.length ? [`skipped (cost cap): ${r.skipped_skills.join(', ')}`, ''] : []),
    `exit code ${r.exit_code}, cost old $${r.cost_usd.old.toFixed(2)} / new $${r.cost_usd.new.toFixed(2)} / judge ${judgeCost}, claude ${r.claude_version ?? '?'}, promptfoo ${r.promptfoo_version}`, '',
    '## Summary', '',
    ...table(['Skill', 'Verdict', 'Old', 'New', 'Flags'],
      r.skills.map((s) => [s.name, s.verdict, pct(s.aggregate.old_pass_rate), pct(s.aggregate.new_pass_rate), s.flags.join(', ')]), maxWidth),
  ];
  const used = (Object.keys(FLAG_LEGEND) as Flag[]).filter((f) => r.skills.some((s) => s.flags.includes(f)));
  if (used.length) lines.push('', ...used.map((f) => `- \`${f}\`: ${FLAG_LEGEND[f]}`));
  const triggers = r.skills.flatMap((s) => s.trigger ? [{ name: s.name, ...s.trigger }] : []);
  if (triggers.length) {
    lines.push('', '## Trigger precision / recall', '',
      ...table(['Skill', 'Verdict', 'Old precision', 'New precision', 'Old recall', 'New recall', 'Max metric P_reg'],
        triggers.map((t) => [t.name, t.verdict, pct(t.old.precision), pct(t.new.precision), pct(t.old.recall), pct(t.new.recall), t.p_reg.toFixed(2)]), maxWidth),
      '', '### Trigger metrics', '',
      ...table(['Skill', 'Metric', 'Verdict', 'P_reg'],
        triggers.flatMap((t) => (['precision', 'recall'] as const).map((kind) => {
          const m = t[kind];
          return [t.name, kind, m?.verdict ?? 'n/a', m ? m.p_reg.toFixed(2) : 'n/a'];
        })), maxWidth),
      '', '### Trigger cases', '',
      ...table(['Skill', 'Case', 'Expected trigger', 'Verdict', 'Old correct/runs', 'New correct/runs', 'P_reg'],
        triggers.flatMap((t) => t.cases.map((c) => [t.name, c.name, c.expected ? 'yes' : 'no', c.verdict, `${c.old.passed}/${c.old.runs}`, `${c.new.passed}/${c.new.runs}`, c.p_reg.toFixed(2)])), maxWidth));
  }
  for (const s of r.skills) {
    const bad = s.cases.filter((c) => c.verdict !== 'UNCHANGED' || (c.deterministic && c.deterministic.verdict !== 'UNCHANGED'));
    if (!bad.length) continue;
    lines.push('', `## Changed cases: ${s.name}`, '',
      ...table(['Case', 'Verdict', 'Old', 'New', 'P_reg', 'Judge'],
        bad.map((c) => [c.name, c.verdict, `${c.old.passed}/${c.old.runs}`, `${c.new.passed}/${c.new.runs}`, c.p_reg.toFixed(2), c.judge_dependent ? 'yes' : 'no']), maxWidth));
    for (const c of bad) if (c.deterministic && c.judge_dependent) {
      const d = c.deterministic;
      lines.push('', `- ${c.name} deterministic assertions: ${d.verdict}, old ${d.old.passed}/${d.old.runs}, new ${d.new.passed}/${d.new.runs}, P_reg ${d.p_reg.toFixed(2)}`);
    }
    for (const c of bad) for (const e of c.evidence) lines.push('', `- ${c.name} run ${e.run_idx}: failed ${e.failed_assertions.join(', ') || '(none)'}`, '', '  ```', ...e.excerpt.split('\n').map((l) => `  ${l}`), '  ```');
  }
  return lines.join('\n') + '\n';
}
