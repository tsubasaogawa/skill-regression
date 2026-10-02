import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { fromEvalsJson, type EvalsJson } from './fromEvalsJson.js';
import type { Case } from './types.js';

export type CaseSource = 'cases.yaml' | 'evals.json' | 'generated';

export interface SkillCases {
  skill: string;
  dir: string;
  source: CaseSource;
  cases: Case[];
  casesDir?: string;
}

export function listSkills(skillsDir: string): string[] {
  return readdirSync(skillsDir)
    .filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')))
    .sort();
}

export function resolveCases(skillsDir: string, skill: string): SkillCases {
  const dir = join(skillsDir, skill);
  if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`skill not found: ${skill}`);
  const read = (file: string) => readFileSync(join(dir, 'evals', file), 'utf8');
  if (existsSync(join(dir, 'evals', 'cases.yaml'))) return { skill, dir, source: 'cases.yaml', cases: validateCases(parse(read('cases.yaml')), dir) };
  if (existsSync(join(dir, 'evals', 'evals.json'))) return { skill, dir, source: 'evals.json', cases: validateCases(fromEvalsJson(JSON.parse(read('evals.json')) as EvalsJson), dir) };
  // generated cases live in the store; see cli.ts resolveSkill
  return { skill, dir, source: 'generated', cases: [] };
}

export function validateCases(value: unknown, dir: string): Case[] {
  if (!Array.isArray(value) || !value.length) throw new Error('cases must be a non-empty list');
  const names = new Set<string>();
  const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
  for (const c of value) {
    if (!c || !text(c.name) || !text(c.prompt) || !Array.isArray(c.tags) || !Array.isArray(c.files) || !Array.isArray(c.assertions)) {
      throw new Error('each case requires name, prompt, tags, files and assertions');
    }
    if (names.has(c.name)) throw new Error(`duplicate case name: ${c.name}`);
    names.add(c.name);
    if (c.tags.some((t: unknown) => !['trigger', 'no-trigger', 'quality'].includes(String(t)))
      || (c.tags.includes('trigger') && c.tags.includes('no-trigger'))) throw new Error(`invalid tags for case: ${c.name}`);
    for (const file of c.files) {
      if (!text(file)) throw new Error(`invalid input file for case: ${c.name}`);
      const path = relative(resolve(dir), resolve(dir, file));
      if (isAbsolute(file) || path === '..' || path.startsWith('../') || !existsSync(join(dir, file))) {
        throw new Error(`case input must exist inside the skill directory: ${file}`);
      }
    }
    for (const a of c.assertions) {
      const field = a && ({ regex: 'pattern', contains: 'value', file_exists: 'path', llm_rubric: 'rubric' } as Record<string, string>)[a.type];
      if (!a || (!['skill_used', 'skill_not_used'].includes(a.type) && (!field || !text(a[field])))) {
        throw new Error(`invalid assertion for case: ${c.name}`);
      }
    }
  }
  return value as Case[];
}
