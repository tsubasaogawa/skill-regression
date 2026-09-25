#!/usr/bin/env node
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { listSkills, resolveCases } from './cases/load.js';
import { buildFixture } from './planner/fixture.js';
import { runSkill } from './runner/promptfoo.js';
import { compareSkill } from './comparator/verdict.js';
import { hashCases, hashDir } from './cases/hash.js';
import { cacheKey, Store } from './store/store.js';
import { buildReport, exitCode, skillFlags, toMarkdown, type SkillReport } from './reporter/report.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cliVersion } from './runner/version.js';
import type { RunResult } from './runner/types.js';
import { resolve } from 'node:path';

const DEFAULT_SKILLS_DIR = join(homedir(), '.claude', 'skills');
const program = new Command().name('skilldrift').version('0.1.0');

program
  .command('compare')
  .description('Compare skill behaviour between two models')
  .option('--skills-dir <dir>', 'skills directory', DEFAULT_SKILLS_DIR)
  .option('--fixtures-dir <dir>', 'fixtures root', 'fixtures')
  .option('--skill <name>', 'only this skill')
  .option('--case <name>', 'only this case')
  .option('--old <model>', 'baseline model')
  .option('--new <model>', 'candidate model')
  .option('--runs <n>', 'runs per case per model', '1')
  .option('--judge <model>', 'judge model for llm_rubric', 'claude-haiku-4-5-20251001')
  .option('--concurrency <n>', 'max concurrent runs', '2')
  .option('--store <dir>', 'store directory', '.skilldrift')
  .option('--no-cache', 'rerun even if results for the same key exist')
  .option('--out <dir>', 'report directory (default: <store>/reports/claude/<new-model>/<timestamp>)')
  .option('--format <fmt>', 'md | json | both', 'both')
  .option('--dry-run', 'list skills and resolved cases without running')
  .action(async (opts: { skillsDir: string; fixturesDir: string; skill?: string; case?: string; old?: string; new?: string; runs: string; judge: string; concurrency: string; store: string; cache: boolean; out?: string; format: string; dryRun?: boolean }) => {
    const skills = listSkills(opts.skillsDir)
      .filter((s) => !opts.skill || s === opts.skill)
      .map((s) => resolveCases(opts.skillsDir, s))
      .map((sc) => ({ ...sc, cases: sc.cases.filter((c) => !opts.case || c.name === opts.case) }));
    if (opts.dryRun) {
      for (const s of skills) console.log(`${s.skill.padEnd(36)} ${String(s.cases.length).padStart(3)} cases (${s.source})`);
      console.log(`\n${skills.length} skills, ${skills.reduce((n, s) => n + s.cases.length, 0)} cases`);
      return;
    }
    if (!opts.old || !opts.new) return program.error('--old and --new are required');
    const claudeVersion = cliVersion('claude');
    const store = new Store(opts.store);
    const runs = Number(opts.runs);
    const startedAt = new Date();
    const allResults: RunResult[] = [];
    const reports: SkillReport[] = [];
    for (const sc of skills.filter((s) => s.cases.length > 0)) {
      const base = { skill: sc.skill, skillHash: hashDir(sc.dir), casesHash: hashCases(sc.cases), judge: opts.judge, runs };
      const keys = new Map([...new Set([opts.old, opts.new])].map((m) => [m, cacheKey({ ...base, model: m })]));
      const results: RunResult[] = [];
      const toRun: string[] = [];
      for (const [model, key] of keys) {
        const cached = opts.cache ? store.lookup(key) : [];
        if (cached.length) { console.error(`${sc.skill}: ${model} cached (${key})`); results.push(...cached); } else toRun.push(model);
      }
      if (toRun.length) {
        const workingDir = resolve(buildFixture(sc, opts.fixturesDir));
        const fresh = await runSkill(sc, {
          models: toRun, runs, judgeModel: opts.judge, workingDir, maxConcurrency: Number(opts.concurrency),
          onProgress: (c, t) => console.error(`${sc.skill}: ${c}/${t}`),
        }, claudeVersion);
        store.saveRaw(sc.skill, fresh.raw);
        for (const model of toRun) store.appendResults(keys.get(model)!, fresh.results.filter((r) => r.model === model));
        results.push(...fresh.results);
      }
      const tagsOf = (c: string) => sc.cases.find((x) => x.name === c)?.tags ?? [];
      const sr: SkillReport = { ...compareSkill(sc.skill, results, opts.old, opts.new, tagsOf), flags: [], cases_source: sc.source, cases_hash: base.casesHash };
      sr.flags = skillFlags(sr, sc.source);
      const meta = { skill: sc.skill, agent: 'claude', old_model: opts.old, new_model: opts.new };
      for (const c of sr.cases) store.appendVerdict({ ...meta, case: c.name, ...c });
      store.appendVerdict({ ...meta, case: null, verdict: sr.verdict, flags: sr.flags, aggregate: sr.aggregate, keys: Object.fromEntries(keys) });
      allResults.push(...results);
      reports.push(sr);
    }
    const report = buildReport(reports, allResults, { oldModel: opts.old, newModel: opts.new, startedAt, claudeVersion });
    const out = opts.out ?? join(opts.store, 'reports', 'claude', opts.new, startedAt.toISOString().replace(/[:.]/g, '-'));
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
  .option('--skills-dir <dir>', 'skills directory', DEFAULT_SKILLS_DIR)
  .action((action: string, skill: string, opts: { skillsDir: string }) => {
    if (action !== 'export') program.error(`unknown action: ${action}`);
    process.stdout.write(stringify(resolveCases(opts.skillsDir, skill).cases));
  });

program
  .command('fixture')
  .argument('<skill>', 'skill name')
  .description('Build fixtures/<skill>/ working directory')
  .option('--skills-dir <dir>', 'skills directory', DEFAULT_SKILLS_DIR)
  .option('--fixtures-dir <dir>', 'fixtures root', 'fixtures')
  .action((skill: string, opts: { skillsDir: string; fixturesDir: string }) => {
    console.log(buildFixture(resolveCases(opts.skillsDir, skill), opts.fixturesDir));
  });

program.parse();
