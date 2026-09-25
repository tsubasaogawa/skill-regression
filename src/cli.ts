#!/usr/bin/env node
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { listSkills, resolveCases } from './cases/load.js';
import { buildFixture } from './planner/fixture.js';
import { runSkill } from './runner/promptfoo.js';
import { compareSkill } from './comparator/verdict.js';
import { cliVersion } from './runner/version.js';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  .option('--dry-run', 'list skills and resolved cases without running')
  .action(async (opts: { skillsDir: string; fixturesDir: string; skill?: string; case?: string; old?: string; new?: string; runs: string; judge: string; concurrency: string; dryRun?: boolean }) => {
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
    const models = opts.old === opts.new ? [opts.old] : [opts.old, opts.new];
    for (const sc of skills.filter((s) => s.cases.length > 0)) {
      const workingDir = resolve(buildFixture(sc, opts.fixturesDir));
      const { results, raw } = await runSkill(sc, {
        models, runs: Number(opts.runs), judgeModel: opts.judge, workingDir, maxConcurrency: Number(opts.concurrency),
        onProgress: (c, t) => console.error(`${sc.skill}: ${c}/${t}`),
      }, claudeVersion);
      mkdirSync('raw', { recursive: true });
      writeFileSync(`raw/${sc.skill}-${Date.now()}.json`, JSON.stringify(raw, null, 2));
      for (const r of results) console.log(JSON.stringify(r));
      console.log(JSON.stringify(compareSkill(sc.skill, results, opts.old, opts.new)));
    }
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
