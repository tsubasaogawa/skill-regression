import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
    .filter((name) => name !== 'skill-creator')
    .filter((name) => statSync(join(skillsDir, name)).isDirectory() && existsSync(join(skillsDir, name, 'SKILL.md')))
    .sort();
}

export function resolveCases(skillsDir: string, skill: string): SkillCases {
  const dir = join(skillsDir, skill);
  const yamlPath = join(dir, 'evals', 'cases.yaml');
  const jsonPath = join(dir, 'evals', 'evals.json');
  if (existsSync(yamlPath)) {
    return { skill, dir, source: 'cases.yaml', cases: parse(readFileSync(yamlPath, 'utf8')) as Case[] };
  }
  if (existsSync(jsonPath)) {
    const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as EvalsJson;
    return { skill, dir, source: 'evals.json', cases: fromEvalsJson(json) };
  }
  // generated cases live in the store; see cli.ts resolveSkill
  return { skill, dir, source: 'generated', cases: [] };
}
