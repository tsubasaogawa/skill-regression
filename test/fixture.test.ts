import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveCases } from '../src/cases/load.js';
import { buildFixture, buildRunDirs, runDir } from '../src/planner/fixture.js';
import { aCase, tmpRoot, writeSkill } from './helpers.js';

it('builds fixture with both skill copies, case files and assets', () => {
  const tmp = tmpRoot();
  const skillDir = writeSkill(join(tmp, 'skills'), 's');
  mkdirSync(join(skillDir, 'evals', 'files'), { recursive: true });
  writeFileSync(join(skillDir, 'evals', 'files', 'in.md'), 'x');
  writeFileSync(join(skillDir, 'evals', 'evals.json'), JSON.stringify({ skill_name: 's', evals: [{ id: 1, prompt: 'p', files: ['evals/files/in.md'] }] }));

  const root = buildFixture(resolveCases(join(tmp, 'skills'), 's'), join(tmp, 'fixtures'));

  for (const f of ['.claude/skills/s/SKILL.md', '.agents/skills/s/SKILL.md', 'evals/files/in.md', 'assets/file_exists.js', 'tmp']) {
    expect(existsSync(join(root, f)), f).toBe(true);
  }
  expect(existsSync(join(root, '.claude/skills/s/evals'))).toBe(false);
});

it('builds a fresh working dir per case and run holding only that case\'s files', () => {
  const tmp = tmpRoot();
  const skillDir = writeSkill(join(tmp, 'skills'), 's', [
    aCase('edit-a', { files: ['evals/a.md'] }),
    aCase('use b', { files: ['evals/b.md'] }),
  ]);
  writeFileSync(join(skillDir, 'evals', 'a.md'), 'a');
  writeFileSync(join(skillDir, 'evals', 'b.md'), 'b');
  const sc = resolveCases(join(tmp, 'skills'), 's');

  const root = buildRunDirs(sc, join(tmp, 'fixtures'), 2);
  expect(readdirSync(root)).toHaveLength(2);
  for (const i of [0, 1]) {
    const a = runDir(root, 'edit-a', i);
    const b = runDir(root, 'use b', i);
    for (const f of ['.claude/skills/s/SKILL.md', '.agents/skills/s/SKILL.md', 'evals/a.md', 'assets/file_exists.js', 'tmp']) expect(existsSync(join(a, f)), f).toBe(true);
    expect(existsSync(join(a, 'evals/b.md'))).toBe(false);
    expect(existsSync(join(b, 'evals/b.md'))).toBe(true);
    expect(existsSync(join(b, 'evals/a.md'))).toBe(false);
  }

  // what one run changes stays in its own dir, and the next build starts clean again
  writeFileSync(join(runDir(root, 'edit-a', 0), 'evals', 'a.md'), 'changed');
  writeFileSync(join(runDir(root, 'edit-a', 0), 'tmp', 'out.txt'), 'out');
  expect(readFileSync(join(runDir(root, 'edit-a', 1), 'evals', 'a.md'), 'utf8')).toBe('a');
  expect(readdirSync(join(runDir(root, 'edit-a', 1), 'tmp'))).toEqual([]);
  buildRunDirs(sc, join(tmp, 'fixtures'), 2);
  expect(readFileSync(join(runDir(root, 'edit-a', 0), 'evals', 'a.md'), 'utf8')).toBe('a');
  expect(readdirSync(join(runDir(root, 'edit-a', 0), 'tmp'))).toEqual([]);
});
