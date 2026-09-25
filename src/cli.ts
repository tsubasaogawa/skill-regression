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
  .option('--old-skills-dir <dir>', 'skills directory for the baseline side (default: --skills-dir)')
  .option('--runs <n>', 'runs per case per model', '1')
  .option('--judge <model>', 'judge model for llm_rubric', 'claude-haiku-4-5-20251001')
  .option('--concurrency <n>', 'max concurrent runs', '2')
  .option('--store <dir>', 'store directory', '.skilldrift')
  .option('--no-cache', 'rerun even if results for the same key exist')
  .option('--out <dir>', 'report directory (default: <store>/reports/claude/<new-model>/<timestamp>)')
  .option('--format <fmt>', 'md | json | both', 'both')
  .option('--dry-run', 'list skills and resolved cases without running')
  .action(async (opts: { skillsDir: string; fixturesDir: string; skill?: string; case?: string; old?: string; new?: string; oldSkillsDir?: string; runs: string; judge: string; concurrency: string; store: string; cache: boolean; out?: string; format: string; dryRun?: boolean }) => {
    const resolveSkill = (dir: string, s: string) => {
      const sc = resolveCases(dir, s);
      return { ...sc, cases: sc.cases.filter((c) => !opts.case || c.name === opts.case) };
    };
    const names = listSkills(opts.skillsDir).filter((s) => !opts.skill || s === opts.skill);
    if (opts.dryRun) {
      const skills = names.map((s) => resolveSkill(opts.skillsDir, s));
      for (const s of skills) console.log(`${s.skill.padEnd(36)} ${String(s.cases.length).padStart(3)} cases (${s.source})`);
      console.log(`\n${skills.length} skills, ${skills.reduce((n, s) => n + s.cases.length, 0)} cases`);
      return;
    }
    if (!opts.old || !opts.new) return program.error('--old and --new are required');
    const claudeVersion = cliVersion('claude');
    const store = new Store(opts.store);
    const runs = Number(opts.runs);
    const startedAt = new Date();
    const sides = { old: { model: opts.old, dir: opts.oldSkillsDir ?? opts.skillsDir }, new: { model: opts.new, dir: opts.skillsDir } } as const;
    const all = { old: [] as RunResult[], new: [] as RunResult[] };
    const reports: SkillReport[] = [];
    for (const name of names) {
      const scNew = resolveSkill(sides.new.dir, name);
      if (!scNew.cases.length) continue;
      const results = { old: [] as RunResult[], new: [] as RunResult[] };
      const keys = {} as Record<'old' | 'new', string>;
      for (const side of ['old', 'new'] as const) {
        const sc = side === 'new' ? scNew : resolveSkill(sides.old.dir, name);
        const key = cacheKey({ skill: name, skillHash: hashDir(sc.dir), casesHash: hashCases(sc.cases), model: sides[side].model, judge: opts.judge, runs });
        keys[side] = key;
        const cached = opts.cache ? store.lookup(key) : [];
        if (side === 'new' && key === keys.old) { results.new = results.old; console.error(`${name}: new side shares the old side results (${key})`); continue; }
        if (cached.length) { console.error(`${name}: ${side} (${sides[side].model}) cached (${key})`); results[side] = cached; continue; }
        const workingDir = resolve(buildFixture(sc, opts.fixturesDir));
        const fresh = await runSkill(sc, {
          models: [sides[side].model], runs, judgeModel: opts.judge, workingDir, maxConcurrency: Number(opts.concurrency),
          onProgress: (c, t) => console.error(`${name} ${side}: ${c}/${t}`),
        }, claudeVersion);
        store.saveRaw(name, fresh.raw);
        store.appendResults(key, fresh.results);
        results[side] = fresh.results;
      }
      const tagsOf = (c: string) => scNew.cases.find((x) => x.name === c)?.tags ?? [];
      const sr: SkillReport = { ...compareSkill(name, results.old, results.new, tagsOf), flags: [], cases_source: scNew.source, cases_hash: hashCases(scNew.cases) };
      sr.flags = skillFlags(sr, scNew.source);
      const meta = { skill: name, agent: 'claude', old_model: opts.old, new_model: opts.new };
      for (const c of sr.cases) store.appendVerdict({ ...meta, case: c.name, ...c });
      store.appendVerdict({ ...meta, case: null, verdict: sr.verdict, flags: sr.flags, aggregate: sr.aggregate, keys });
      all.old.push(...results.old);
      all.new.push(...results.new);
      reports.push(sr);
    }
    const report = buildReport(reports, all, { oldModel: opts.old, newModel: opts.new, startedAt, claudeVersion });
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
