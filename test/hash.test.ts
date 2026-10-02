import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { hashCaseInputs, hashDir, hashSkillMd } from '../src/cases/hash.js';
import type { Case } from '../src/cases/types.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('invalidates execution results for changed inputs but regenerates cases only for changed SKILL.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skilldrift-hash-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'evals'));
  writeFileSync(join(dir, 'SKILL.md'), '# Skill');
  writeFileSync(join(dir, 'helper.py'), 'original');
  writeFileSync(join(dir, 'evals', 'input.txt'), 'original input');
  const cases: Case[] = [{ name: 'c', prompt: 'p', tags: [], files: ['evals/input.txt'], assertions: [] }];
  const generated = hashSkillMd(dir), skill = hashDir(dir), inputs = hashCaseInputs(cases, dir);
  writeFileSync(join(dir, 'helper.py'), 'updated');
  expect(hashSkillMd(dir)).toBe(generated);
  expect(hashDir(dir)).not.toBe(skill);
  writeFileSync(join(dir, 'evals', 'input.txt'), 'updated input');
  expect(hashCaseInputs(cases, dir)).not.toBe(inputs);
  writeFileSync(join(dir, 'SKILL.md'), '# Updated Skill');
  expect(hashSkillMd(dir)).not.toBe(generated);
});
