import { createRequire } from 'node:module';
import type { SkillComparison } from '../comparator/verdict.js';
import type { CaseSource } from '../cases/load.js';
import type { RunResult } from '../runner/types.js';

const require = createRequire(import.meta.url);

export type Flag = 'generated-cases' | 'judge-dependent' | 'low-power' | 'partial';
export interface SkillReport extends SkillComparison { flags: Flag[]; cases_source: CaseSource; cases_hash: string }
export interface Report {
  skilldrift_version: string; promptfoo_version: string; agent: string;
  old_model: string; new_model: string; claude_version?: string;
  started_at: string; finished_at: string;
  cost_usd: { old: number; new: number; judge: number | null };
  exit_code: number; skills: SkillReport[];
}

export function skillFlags(sc: SkillComparison, source: CaseSource): Flag[] {
  const f: Flag[] = [];
  if (source === 'generated') f.push('generated-cases');
  if (sc.cases.some((c) => c.judge_dependent)) f.push('judge-dependent');
  if (sc.cases.some((c) => c.old.errors + c.new.errors > 0)) f.push('partial');
  return f;
}

/** 0 = no regression, 1 = regression on a deterministic case, 2 = degraded, inconclusive or partial. Judge-dependent regressions are report-only. */
export function exitCode(skills: SkillReport[]): number {
  const cases = skills.flatMap((s) => s.cases);
  if (cases.some((c) => c.verdict === 'REGRESSED' && !c.judge_dependent)
    || skills.some((s) => s.trigger?.verdict === 'REGRESSED')) return 1;
  if (cases.some((c) => c.verdict === 'INCONCLUSIVE')
    || skills.some((s) => s.verdict === 'DEGRADED' || s.trigger?.verdict === 'INCONCLUSIVE' || s.flags.includes('partial'))) return 2;
  return 0;
}

export function buildReport(skills: SkillReport[], results: { old: RunResult[]; new: RunResult[] }, o: { oldModel: string; newModel: string; startedAt: Date; claudeVersion?: string }): Report {
  const cost = (rs: RunResult[]) => rs.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  return {
    skilldrift_version: require('../../package.json').version,
    promptfoo_version: require(require.resolve('promptfoo').replace(/dist[\/].*$/, 'package.json')).version,
    agent: 'claude', old_model: o.oldModel, new_model: o.newModel,
    ...(o.claudeVersion ? { claude_version: o.claudeVersion } : {}),
    started_at: o.startedAt.toISOString(), finished_at: new Date().toISOString(),
    cost_usd: { old: cost(results.old), new: cost(results.new), judge: null },
    exit_code: exitCode(skills), skills,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const maybePct = (x: number | null) => x === null ? 'n/a' : pct(x);

export function toMarkdown(r: Report): string {
  const judgeCost = r.cost_usd.judge == null ? 'unavailable' : `$${r.cost_usd.judge.toFixed(2)}`;
  const lines = [
    `# skilldrift: ${r.old_model} → ${r.new_model}`, '',
    `exit code ${r.exit_code}, cost old $${r.cost_usd.old.toFixed(2)} / new $${r.cost_usd.new.toFixed(2)} / judge ${judgeCost}, claude ${r.claude_version ?? '?'}, promptfoo ${r.promptfoo_version}`, '',
    '| Skill | Verdict | Old | New | Flags |', '| --- | --- | --- | --- | --- |',
    ...r.skills.map((s) => `| ${s.name} | ${s.verdict} | ${pct(s.aggregate.old_pass_rate)} | ${pct(s.aggregate.new_pass_rate)} | ${s.flags.join(', ')} |`),
  ];
  const triggerSkills = r.skills.filter((s) => s.trigger);
  if (triggerSkills.length) {
    lines.push('', '## Trigger precision / recall', '',
      '| Skill | Verdict | Old precision | New precision | Old recall | New recall | P_reg |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...triggerSkills.map((s) => `| ${s.name} | ${s.trigger!.verdict} | ${maybePct(s.trigger!.old.precision)} | ${maybePct(s.trigger!.new.precision)} | ${maybePct(s.trigger!.old.recall)} | ${maybePct(s.trigger!.new.recall)} | ${s.trigger!.p_reg.toFixed(2)} |`),
      '',
      '| Skill | Case | Expected trigger | Verdict | Old correct/runs | New correct/runs | P_reg |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...triggerSkills.flatMap((s) => s.trigger!.cases.map((c) => `| ${s.name} | ${c.name} | ${c.expected ? 'yes' : 'no'} | ${c.verdict} | ${c.old.passed}/${c.old.runs} | ${c.new.passed}/${c.new.runs} | ${c.p_reg.toFixed(2)} |`)));
  }
  for (const s of r.skills) {
    const bad = s.cases.filter((c) => c.verdict !== 'UNCHANGED');
    if (!bad.length) continue;
    lines.push('', `## ${s.name}`, '', '| Case | Verdict | Old | New | P_reg | Judge |', '| --- | --- | --- | --- | --- | --- |',
      ...bad.map((c) => `| ${c.name} | ${c.verdict} | ${c.old.passed}/${c.old.runs} | ${c.new.passed}/${c.new.runs} | ${c.p_reg.toFixed(2)} | ${c.judge_dependent ? 'yes' : 'no'} |`));
    for (const c of bad) for (const e of c.evidence) lines.push('', `- ${c.name} run ${e.run_idx}: failed ${e.failed_assertions.join(', ') || '(none)'}`, '', '  ```', ...e.excerpt.split('\n').map((l) => `  ${l}`), '  ```');
  }
  return lines.join('\n') + '\n';
}
