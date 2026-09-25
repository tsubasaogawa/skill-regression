#!/usr/bin/env node
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { listSkills, resolveCases } from './cases/load.js';

const DEFAULT_SKILLS_DIR = join(homedir(), '.claude', 'skills');
const program = new Command().name('skilldrift').version('0.1.0');

program
  .command('compare')
  .description('Compare skill behaviour between two models')
  .option('--skills-dir <dir>', 'skills directory', DEFAULT_SKILLS_DIR)
  .option('--dry-run', 'list skills and resolved cases without running')
  .action((opts: { skillsDir: string; dryRun?: boolean }) => {
    const skills = listSkills(opts.skillsDir).map((s) => resolveCases(opts.skillsDir, s));
    if (opts.dryRun) {
      for (const s of skills) console.log(`${s.skill.padEnd(36)} ${String(s.cases.length).padStart(3)} cases (${s.source})`);
      console.log(`\n${skills.length} skills, ${skills.reduce((n, s) => n + s.cases.length, 0)} cases`);
      return;
    }
    console.error('compare: not implemented yet, use --dry-run');
    process.exit(2);
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

program.parse();
