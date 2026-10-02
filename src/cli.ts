#!/usr/bin/env node
import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stringify } from 'yaml';
import { listSkills, resolveCases, type SkillCases } from './cases/load.js';
import { generateCases } from './cases/generate.js';
import type { Case } from './cases/types.js';
import { DEFAULTS, JUDGE_PROVIDER } from './config/defaults.js';
import { readSuiteConfig, resolveCompareConfig, selectSkills } from './config/suite.js';
import { buildFixture } from './planner/fixture.js';
import { runSkill, runSkillCase } from './runner/promptfoo.js';
import { compareSkill } from './comparator/verdict.js';
import { hashCases, hashDir } from './cases/hash.js';
import { cacheKey, Store } from './store/store.js';
import { buildReport, exitCode, skillFlags, toMarkdown, type SkillReport } from './reporter/report.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cliVersion } from './runner/version.js';
import type { RunResult } from './runner/types.js';
import { fileURLToPath } from 'node:url';

export const program = new Command().name('skilldrift').version('0.1.0');
type Side = 'old' | 'new';

async function promptForModel(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const guidance = label === 'Baseline model' ? 'pass --old or set baseline_model in suite.yaml' : 'pass --new';
    throw new Error(`${label} is required; ${guidance}`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(`${label}: `)).trim();
    if (!answer) throw new Error(`${label} is required`);
    return answer;
  } finally {
    prompt.close();
  }
}

function countRuns(results: RunResult[], caseNames: string[]): number {
  if (!caseNames.length) return 0;
  return Math.min(...caseNames.map((name) => results.filter((r) => r.case === name).length));
}

function limitRuns(results: RunResult[], runs: number): RunResult[] {
  const seen = new Map<string, number>();
  return results.filter((result) => {
    const count = seen.get(result.case) ?? 0;
    if (count >= runs) return false;
    seen.set(result.case, count + 1);
    return true;
  });
}

function reindexResults(existing: RunResult[], fresh: RunResult[]): RunResult[] {
  const next = new Map<string, number>();
  for (const result of existing) {
    next.set(result.case, Math.max(next.get(result.case) ?? 0, result.run_idx + 1));
  }
  return fresh.map((result) => {
    const run_idx = next.get(result.case) ?? 0;
    next.set(result.case, run_idx + 1);
    return { ...result, run_idx };
  });
}

program
  .command('compare')
  .description('Compare skill behaviour between two models')
  .option('--suite <file>', 'suite configuration file (default: suite.yaml)')
  .option('--skills-dir <dir>', 'skills directory', DEFAULTS.skillsDir)
  .option('--fixtures-dir <dir>', 'fixtures root', DEFAULTS.fixturesDir)
  .option('--skill <name>', 'only this skill')
  .option('--case <name>', 'only this case')
  .option('--old <model>', 'baseline model')
  .option('--new <model>', 'candidate model')
  .option('--old-skills-dir <dir>', 'skills directory for the baseline side (default: --skills-dir)')
  .option('--runs <n>', 'runs per case per model')
  .option('--runs-max <n>', 'maximum runs per case per model (default: --runs)')
  .option('--judge <model>', 'judge model for llm_rubric', DEFAULTS.judgeModel)
  .option('--case-generator <model>', 'model that generates cases for skills without evals (default: suite case_generator_model)')
  .option('--concurrency <n>', 'max concurrent runs', String(DEFAULTS.concurrency))
  .option('--store <dir>', 'store directory', DEFAULTS.store)
  .option('--aggregate-drop-pt <n>', 'aggregate pass-rate drop (0-1) at which a skill without regressed cases is DEGRADED')
  .option('--no-cache', 'rerun even if results for the same key exist')
  .option('--out <dir>', 'report directory (default: <store>/reports/claude/<new-model>/<timestamp>)')
  .option('--format <fmt>', 'md | json | both', DEFAULTS.format)
  .option('--dry-run', 'list skills and resolved cases without running')
  .action(async (opts: { suite?: string; skillsDir: string; fixturesDir: string; skill?: string; case?: string; old?: string; new?: string; oldSkillsDir?: string; runs?: string; runsMax?: string; judge: string; caseGenerator?: string; concurrency: string; store: string; aggregateDropPt?: string; cache: boolean; out?: string; format: string; dryRun?: boolean }) => {
    const suite = readSuiteConfig(opts.suite ?? DEFAULTS.suitePath, opts.suite === undefined);
    const availableSkills = listSkills(opts.skillsDir);
    const selectedSkills = selectSkills(opts.skill, suite, availableSkills);
    const store = new Store(opts.store);
    const filterCase = (sc: SkillCases, cases: Case[] = sc.cases): SkillCases => ({ ...sc, cases: cases.filter((c) => !opts.case || c.name === opts.case) });
    const resolveSkill = async (dir: string, s: string, generator?: string): Promise<SkillCases> => {
      const sc = resolveCases(dir, s);
      if (sc.source !== 'generated') return filterCase(sc);
      const hash = hashDir(sc.dir);
      let cases = store.loadGenerated(s, hash);
      if (!cases && generator) {
        console.error(`${s}: generating cases with ${generator}`);
        cases = await generateCases(s, sc.dir, generator);
        console.error(`${s}: saved generated cases to ${store.saveGenerated(s, hash, cases)}`);
      }
      return filterCase(sc, cases ?? []);
    };
    if (opts.dryRun) {
      const skills = await Promise.all(selectedSkills.map((s) => resolveSkill(opts.skillsDir, s)));
      for (const s of skills) console.log(`${s.skill.padEnd(36)} ${String(s.cases.length).padStart(3)} cases (${s.source}${s.source === 'generated' && !s.cases.length ? ', pending' : ''})`);
      console.log(`\n${skills.length} skills, ${skills.reduce((n, s) => n + s.cases.length, 0)} cases`);
      return;
    }
    const config = await resolveCompareConfig({
      old: opts.old, new: opts.new, skill: opts.skill, runs: opts.runs, aggregateDropPt: opts.aggregateDropPt, caseGenerator: opts.caseGenerator,
    }, suite, availableSkills, promptForModel);
    const names = config.skills;
    const oldModel = config.oldModel;
    const newModel = config.newModel;
    const claudeVersion = cliVersion('claude');
    const runs = config.runs;
    const runsMax = opts.runsMax == null ? runs : Number(opts.runsMax);
    if (!Number.isInteger(runs) || runs < 1) return program.error('--runs must be a positive integer');
    if (!Number.isInteger(runsMax) || runsMax < runs) return program.error('--runs-max must be an integer greater than or equal to --runs');
    const startedAt = new Date();
    const sides = { old: { model: oldModel, dir: opts.oldSkillsDir ?? opts.skillsDir }, new: { model: newModel, dir: opts.skillsDir } } as const;
    const all = { old: [] as RunResult[], new: [] as RunResult[] };
    const reports: SkillReport[] = [];
    for (const name of names) {
      const scNew = await resolveSkill(sides.new.dir, name, config.caseGeneratorModel);
      if (!scNew.cases.length) continue;
      const scOld = scNew.source === 'generated' ? filterCase(resolveCases(sides.old.dir, name), scNew.cases) : await resolveSkill(sides.old.dir, name);
      const scBySide: Record<Side, SkillCases> = { old: scOld, new: scNew };
      const caseNames = [...new Set([...scOld.cases, ...scNew.cases].map((c) => c.name))];
      const results = { old: [] as RunResult[], new: [] as RunResult[] };
      const keys = {} as Record<Side, string>;
      const runFresh = async (side: Side, sc: SkillCases, repeat: number, caseName?: string) => {
        const workingDir = resolve(buildFixture(sc, opts.fixturesDir));
        const label = caseName ? `${name} ${side} ${caseName}` : `${name} ${side}`;
        const fresh = caseName
          ? await runSkillCase(sc, caseName, {
            models: [sides[side].model], runs: repeat, judgeModel: opts.judge, workingDir, maxConcurrency: Number(opts.concurrency),
            onProgress: (c, t) => console.error(`${label}: ${c}/${t}`),
          }, claudeVersion)
          : await runSkill(sc, {
            models: [sides[side].model], runs: repeat, judgeModel: opts.judge, workingDir, maxConcurrency: Number(opts.concurrency),
            onProgress: (c, t) => console.error(`${label}: ${c}/${t}`),
          }, claudeVersion);
        const appended = reindexResults(results[side], fresh.results);
        store.saveRaw(name, fresh.raw);
        store.appendResults(keys[side], appended);
        results[side].push(...appended);
      };

      for (const side of ['old', 'new'] as const) {
        const sc = scBySide[side];
        const key = cacheKey({ skill: name, skillHash: hashDir(sc.dir), casesHash: hashCases(sc.cases), model: sides[side].model, judge: `${JUDGE_PROVIDER}:${opts.judge}`, runsMax });
        keys[side] = key;
        const cached = opts.cache ? store.lookup(key) : [];
        if (side === 'new' && key === keys.old) {
          results.new = results.old;
          console.error(`${name}: new side shares the old side results (${key})`);
          continue;
        }
        if (cached.length) {
          console.error(`${name}: ${side} (${sides[side].model}) cached (${key})`);
          results[side] = cached;
        }
        const needed = Math.max(0, runs - countRuns(results[side], sc.cases.map((c) => c.name)));
        if (needed) await runFresh(side, sc, needed);
      }

      const tagsOf = (c: string) => scNew.cases.find((x) => x.name === c)?.tags ?? [];
      let totalRuns = Math.min(runsMax, countRuns(results.old, caseNames), countRuns(results.new, caseNames));
      const compareCurrent = () => compareSkill(
        name,
        totalRuns ? limitRuns(results.old, totalRuns) : results.old,
        totalRuns ? limitRuns(results.new, totalRuns) : results.new,
        tagsOf,
        config.aggregateDropPt,
      );
      let comparison = compareCurrent();
      while (totalRuns < runsMax) {
        const ambiguousCases = comparison.cases.filter((c) => c.needsMoreRuns).map((c) => c.name);
        if (!ambiguousCases.length) break;
        const batchRuns = Math.min(runs, runsMax - totalRuns);
        const targetRuns = totalRuns + batchRuns;
        for (const caseName of ambiguousCases) {
          for (const side of ['old', 'new'] as const) {
            if (side === 'new' && keys.new === keys.old) continue;
            const currentRuns = results[side].filter((r) => r.case === caseName).length;
            const needed = Math.max(0, targetRuns - currentRuns);
            if (needed) await runFresh(side, scBySide[side], needed, caseName);
          }
        }
        totalRuns = targetRuns;
        comparison = compareCurrent();
      }
      const sr: SkillReport = { ...comparison, flags: [], cases_source: scNew.source, cases_hash: hashCases(scNew.cases) };
      sr.flags = skillFlags(sr, scNew.source);
      const meta = { skill: name, agent: 'claude', old_model: oldModel, new_model: newModel };
      for (const c of sr.cases) store.appendVerdict({ ...meta, case: c.name, ...c });
      store.appendVerdict({ ...meta, case: null, verdict: sr.verdict, flags: sr.flags, aggregate: sr.aggregate, trigger: sr.trigger, keys });
      all.old.push(...results.old);
      all.new.push(...results.new);
      reports.push(sr);
    }
    const report = buildReport(reports, all, { oldModel, newModel, startedAt, claudeVersion });
    const out = opts.out ?? join(opts.store, 'reports', 'claude', newModel, startedAt.toISOString().replace(/[:.]/g, '-'));
    mkdirSync(out, { recursive: true });
    if (opts.format !== 'json') writeFileSync(join(out, 'report.md'), toMarkdown(report));
    if (opts.format !== 'md') writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (opts.format === 'json') console.log(JSON.stringify(report, null, 2));
    else { console.log(toMarkdown(report)); console.error(`report: ${out}`); }
    process.exitCode = exitCode(reports);
  });

program
  .command('cases')
  .argument('<action>', 'export')
  .argument('<skill>', 'skill name')
  .description('Print resolved cases of a skill as neutral-format YAML')
  .option('--skills-dir <dir>', 'skills directory', DEFAULTS.skillsDir)
  .option('--store <dir>', 'store directory holding generated cases', DEFAULTS.store)
  .action((action: string, skill: string, opts: { skillsDir: string; store: string }) => {
    if (action !== 'export') program.error(`unknown action: ${action}`);
    const sc = resolveCases(opts.skillsDir, skill);
    const cases = sc.source === 'generated' ? new Store(opts.store).loadGenerated(skill, hashDir(sc.dir)) : sc.cases;
    if (!cases) return program.error(`no generated cases for ${skill}; run compare first`);
    process.stdout.write(stringify(cases));
  });

export function suiteTemplate(o: { baselineModel: string; skills: string[] }): string {
  return [
    '# skilldrift suite configuration (see README)',
    `baseline_model: ${o.baselineModel}`,
    '',
    '# Skills to compare. Omit to compare every skill under --skills-dir.',
    ...(o.skills.length ? ['skills:', ...o.skills.map((s) => `  - ${s}`)] : ['# skills: []']),
    '',
    `runs: ${DEFAULTS.runs}`,
    '# aggregate_drop_pt: 0.1    # pass-rate drop (0-1) that marks a skill DEGRADED',
    `case_generator_model: ${DEFAULTS.caseGeneratorModel}`,
    '',
  ].join('\n');
}

program
  .command('init')
  .description('Write a suite.yaml template')
  .option('--suite <file>', 'output file', DEFAULTS.suitePath)
  .option('--baseline-model <model>', 'baseline model (prompted if omitted)')
  .option('--skills-dir <dir>', 'skills directory used to list skills', DEFAULTS.skillsDir)
  .option('--all-skills', 'write every skill under --skills-dir explicitly instead of omitting skills')
  .option('--force', 'overwrite an existing file')
  .action(async (opts: { suite: string; baselineModel?: string; skillsDir: string; allSkills?: boolean; force?: boolean }) => {
    if (existsSync(opts.suite) && !opts.force) return program.error(`${opts.suite} already exists; pass --force to overwrite`);
    const baselineModel = opts.baselineModel ?? await promptForModel('Baseline model');
    const skills = opts.allSkills ? listSkills(opts.skillsDir) : [];
    writeFileSync(opts.suite, suiteTemplate({ baselineModel, skills }));
    console.error(`wrote ${opts.suite}`);
  });

program
  .command('trend')
  .description('List skill verdict history from the store, oldest first')
  .option('--store <dir>', 'store directory', DEFAULTS.store)
  .option('--skill <name>', 'only this skill')
  .option('--agent <name>', 'only this agent', 'claude')
  .option('--format <fmt>', 'md | json', 'md')
  .action((opts: { store: string; skill?: string; agent: string; format: string }) => {
    const rows = new Store(opts.store).skillVerdicts()
      .filter((v) => (v.agent ?? 'claude') === opts.agent && (!opts.skill || v.skill === opts.skill));
    if (opts.format === 'json') return console.log(JSON.stringify(rows, null, 2));
    const pct = (x?: number) => x == null ? 'n/a' : `${Math.round(x * 100)}%`;
    const lines: string[] = [];
    for (const skill of [...new Set(rows.map((v) => v.skill))]) {
      lines.push(`## ${skill}`, '', '| When | Old | New | Verdict | Old pass | New pass | Flags |', '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows.filter((v) => v.skill === skill).map((v) => `| ${v.ts.slice(0, 16).replace('T', ' ')} | ${v.old_model} | ${v.new_model} | ${v.verdict} | ${pct(v.aggregate?.old_pass_rate)} | ${pct(v.aggregate?.new_pass_rate)} | ${(v.flags ?? []).join(', ')} |`), '');
    }
    console.log(lines.length ? lines.join('\n') : 'no verdicts');
  });

program
  .command('fixture')
  .argument('<skill>', 'skill name')
  .description('Build fixtures/<skill>/ working directory')
  .option('--skills-dir <dir>', 'skills directory', DEFAULTS.skillsDir)
  .option('--fixtures-dir <dir>', 'fixtures root', DEFAULTS.fixturesDir)
  .action((skill: string, opts: { skillsDir: string; fixturesDir: string }) => {
    console.log(buildFixture(resolveCases(opts.skillsDir, skill), opts.fixturesDir));
  });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await program.parseAsync();
}
