import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { fromEvalsJson, type EvalsJson } from './fromEvalsJson.js';
import type { Case } from './types.js';

export type CaseSource = 'cases.yaml' | 'evals.json' | 'generated';

export interface SkillCases {
  skill: string;
  dir: string;
  source: CaseSource;
  cases: Case[];
}

export function listSkills(skillsDir: string): string[] {
  return readdirSync(skillsDir)
    .filter((name) => name !== 'skill-creator' && existsSync(join(skillsDir, name, 'SKILL.md')))
    .sort();
}

export function resolveCases(skillsDir: string, skill: string): SkillCases {
  const dir = join(skillsDir, skill);
  const read = (file: string) => readFileSync(join(dir, 'evals', file), 'utf8');
  if (existsSync(join(dir, 'evals', 'cases.yaml'))) return { skill, dir, source: 'cases.yaml', cases: parse(read('cases.yaml')) as Case[] };
  if (existsSync(join(dir, 'evals', 'evals.json'))) return { skill, dir, source: 'evals.json', cases: fromEvalsJson(JSON.parse(read('evals.json')) as EvalsJson) };
  // generated cases live in the store; see cli.ts resolveSkill
  return { skill, dir, source: 'generated', cases: [] };
}
