import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type CaseSource = 'cases.yaml' | 'evals.json' | 'generated';

export interface SkillCases {
  skill: string;
  dir: string;
  source: CaseSource;
  count: number;
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
    // ponytail: count top-level "- " entries; replace with yaml parse in order 2
    const count = readFileSync(yamlPath, 'utf8').split('\n').filter((l) => l.startsWith('- ')).length;
    return { skill, dir, source: 'cases.yaml', count };
  }
  if (existsSync(jsonPath)) {
    const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as { evals?: unknown[] };
    return { skill, dir, source: 'evals.json', count: json.evals?.length ?? 0 };
  }
  return { skill, dir, source: 'generated', count: 0 };
}
