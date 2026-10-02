import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { listSkills, validateCases } from '../src/cases/load.js';

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
