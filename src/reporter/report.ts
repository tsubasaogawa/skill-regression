import { createRequire } from 'node:module';
import { pRegressed } from '../comparator/beta.js';
import type { CaseComparison, SkillComparison } from '../comparator/verdict.js';
import type { CaseSource } from '../cases/load.js';
import type { RunResult } from '../runner/types.js';

const require = createRequire(import.meta.url);
export const VERSION: string = require('../../package.json').version;

export type Flag = 'generated-cases' | 'judge-dependent' | 'low-power' | 'partial';
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
  if (sc.cases.some((c) => c.old.errors + c.new.errors > 0)) f.push('partial');
  return f;
}

/** 0 = no regression, 1 = regression on a deterministic case, 2 = degraded, inconclusive, partial or skipped. Judge-dependent regressions are report-only. */
export function exitCode(skills: SkillReport[], skipped: string[] = []): number {
  const cases = skills.flatMap((s) => s.cases);
  if (cases.some((c) => c.deterministic?.verdict === 'REGRESSED' || (c.verdict === 'REGRESSED' && !c.judge_dependent))
    || skills.some((s) => s.trigger?.verdict === 'REGRESSED')) return 1;
  if (cases.some((c) => c.verdict === 'INCONCLUSIVE' || c.deterministic?.verdict === 'INCONCLUSIVE')
    || skipped.length
    || skills.some((s) => s.verdict === 'DEGRADED' || s.trigger?.verdict === 'INCONCLUSIVE' || s.flags.includes('partial'))) return 2;
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

export function toMarkdown(r: Report): string {
  const judgeCost = r.cost_usd.judge == null ? 'unavailable' : `$${r.cost_usd.judge.toFixed(2)}`;
  const lines = [
    `# skilldrift: ${r.old_model} → ${r.new_model}`, '',
    ...(r.skipped_skills?.length ? [`skipped (cost cap): ${r.skipped_skills.join(', ')}`, ''] : []),
    `exit code ${r.exit_code}, cost old $${r.cost_usd.old.toFixed(2)} / new $${r.cost_usd.new.toFixed(2)} / judge ${judgeCost}, claude ${r.claude_version ?? '?'}, promptfoo ${r.promptfoo_version}`, '',
    '| Skill | Verdict | Old | New | Flags |', '| --- | --- | --- | --- | --- |',
    ...r.skills.map((s) => `| ${s.name} | ${s.verdict} | ${pct(s.aggregate.old_pass_rate)} | ${pct(s.aggregate.new_pass_rate)} | ${s.flags.join(', ')} |`),
  ];
  const triggers = r.skills.flatMap((s) => s.trigger ? [{ name: s.name, ...s.trigger }] : []);
  if (triggers.length) {
    lines.push('', '## Trigger precision / recall', '',
      '| Skill | Verdict | Old precision | New precision | Old recall | New recall | Max metric P_reg |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...triggers.map((t) => `| ${t.name} | ${t.verdict} | ${pct(t.old.precision)} | ${pct(t.new.precision)} | ${pct(t.old.recall)} | ${pct(t.new.recall)} | ${t.p_reg.toFixed(2)} |`),
      '',
      '| Skill | Case | Expected trigger | Verdict | Old correct/runs | New correct/runs | P_reg |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...triggers.flatMap((t) => t.cases.map((c) => `| ${t.name} | ${c.name} | ${c.expected ? 'yes' : 'no'} | ${c.verdict} | ${c.old.passed}/${c.old.runs} | ${c.new.passed}/${c.new.runs} | ${c.p_reg.toFixed(2)} |`)));
    lines.push('', '| Skill | Metric | Verdict | P_reg |', '| --- | --- | --- | --- |',
      ...triggers.flatMap((t) => (['precision', 'recall'] as const).map((kind) => {
        const m = t[kind];
        return `| ${t.name} | ${kind} | ${m?.verdict ?? 'n/a'} | ${m ? m.p_reg.toFixed(2) : 'n/a'} |`;
      })));
  }
  for (const s of r.skills) {
    const bad = s.cases.filter((c) => c.verdict !== 'UNCHANGED' || (c.deterministic && c.deterministic.verdict !== 'UNCHANGED'));
    if (!bad.length) continue;
    lines.push('', `## ${s.name}`, '', '| Case | Verdict | Old | New | P_reg | Judge |', '| --- | --- | --- | --- | --- | --- |',
      ...bad.map((c) => `| ${c.name} | ${c.verdict} | ${c.old.passed}/${c.old.runs} | ${c.new.passed}/${c.new.runs} | ${c.p_reg.toFixed(2)} | ${c.judge_dependent ? 'yes' : 'no'} |`));
    for (const c of bad) if (c.deterministic && c.judge_dependent) {
      const d = c.deterministic;
      lines.push('', `- ${c.name} deterministic assertions: ${d.verdict}, old ${d.old.passed}/${d.old.runs}, new ${d.new.passed}/${d.new.runs}, P_reg ${d.p_reg.toFixed(2)}`);
    }
    for (const c of bad) for (const e of c.evidence) lines.push('', `- ${c.name} run ${e.run_idx}: failed ${e.failed_assertions.join(', ') || '(none)'}`, '', '  ```', ...e.excerpt.split('\n').map((l) => `  ${l}`), '  ```');
  }
  return lines.join('\n') + '\n';
}
