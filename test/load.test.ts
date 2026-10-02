import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { listSkills, resolveCases, validateCases } from '../src/cases/load.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('includes skill-creator among available skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skilldrift-list-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'skill-creator'));
  writeFileSync(join(dir, 'skill-creator', 'SKILL.md'), '# Skill');
  expect(listSkills(dir)).toEqual(['skill-creator']);
});

it('rejects duplicate names, contradictory tags, missing files and malformed assertions', () => {
  const c = { name: 'c', prompt: 'p', tags: [], files: [], assertions: [] };
  expect(() => validateCases([c, c], '/tmp')).toThrow('duplicate case');
  expect(() => validateCases([{ ...c, tags: ['trigger', 'no-trigger'] }], '/tmp')).toThrow('invalid tags');
  expect(() => validateCases([{ ...c, files: ['../outside'] }], '/tmp')).toThrow('inside the skill');
  expect(() => validateCases([{ ...c, assertions: [{ type: 'regex' }] }], '/tmp')).toThrow('invalid assertion');
});

it('rejects file_exists paths that escape the fixture and skill names that escape the skills dir', () => {
  const c = { name: 'c', prompt: 'p', tags: [], files: [], assertions: [] };
  const fe = (path: string) => [{ ...c, assertions: [{ type: 'file_exists', path }] }];
  for (const bad of ['/home/user', '../x', '.', '/tmp/../../x']) expect(() => validateCases(fe(bad), '/tmp'), bad).toThrow('inside the fixture');
  for (const ok of ['/tmp/a.txt', 'out/a.txt', '/tmp']) expect(validateCases(fe(ok), '/tmp'), ok).toHaveLength(1);
  for (const bad of ['../x', 'a/b', '..', '.']) expect(() => resolveCases('/tmp', bad), bad).toThrow('invalid skill name');
});
