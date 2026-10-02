import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { hashCaseInputs, hashDir, hashSkillMd } from '../src/cases/hash.js';
import { aCase, tmpRoot } from './helpers.js';

it('invalidates execution results for changed inputs but regenerates cases only for changed SKILL.md', () => {
  const dir = tmpRoot();
  mkdirSync(join(dir, 'evals'));
  writeFileSync(join(dir, 'SKILL.md'), '# Skill');
  writeFileSync(join(dir, 'helper.py'), 'original');
  writeFileSync(join(dir, 'evals', 'input.txt'), 'original input');
  const cases = [aCase('c', { files: ['evals/input.txt'] })];
  const generated = hashSkillMd(dir), skill = hashDir(dir), inputs = hashCaseInputs(cases, dir);
  writeFileSync(join(dir, 'helper.py'), 'updated');
  expect(hashSkillMd(dir)).toBe(generated);
  expect(hashDir(dir)).not.toBe(skill);
  writeFileSync(join(dir, 'evals', 'input.txt'), 'updated input');
  expect(hashCaseInputs(cases, dir)).not.toBe(inputs);
  writeFileSync(join(dir, 'SKILL.md'), '# Updated Skill');
  expect(hashSkillMd(dir)).not.toBe(generated);
});
