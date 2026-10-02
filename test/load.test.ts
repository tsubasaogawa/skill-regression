import { expect, it } from 'vitest';
import { listSkills, resolveCases, validateCases } from '../src/cases/load.js';
import { aCase, tmpRoot, writeSkill } from './helpers.js';

const c = aCase('c', { tags: [] });

it('includes skill-creator among available skills', () => {
  const dir = tmpRoot();
  writeSkill(dir, 'skill-creator');
  expect(listSkills(dir)).toEqual(['skill-creator']);
});

it('rejects duplicate names, contradictory tags, missing files and malformed assertions', () => {
  expect(() => validateCases([c, c], '/tmp')).toThrow('duplicate case');
  expect(() => validateCases([{ ...c, tags: ['trigger', 'no-trigger'] }], '/tmp')).toThrow('invalid tags');
  expect(() => validateCases([{ ...c, files: ['../outside'] }], '/tmp')).toThrow('inside the skill');
  expect(() => validateCases([{ ...c, assertions: [{ type: 'regex' }] }], '/tmp')).toThrow('invalid assertion');
});

it('rejects file_exists paths that escape the fixture and skill names that escape the skills dir', () => {
  const fe = (path: string) => [{ ...c, assertions: [{ type: 'file_exists', path }] }];
  for (const bad of ['/home/user', '../x', '.', '/tmp/../../x']) expect(() => validateCases(fe(bad), '/tmp'), bad).toThrow('inside the fixture');
  for (const ok of ['/tmp/a.txt', 'out/a.txt', '/tmp']) expect(validateCases(fe(ok), '/tmp'), ok).toHaveLength(1);
  for (const bad of ['../x', 'a/b', '..', '.']) expect(() => resolveCases('/tmp', bad), bad).toThrow('invalid skill name');
});
