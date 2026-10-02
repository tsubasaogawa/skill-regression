import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { program } from '../src/cli.js';
import { readSuiteConfig } from '../src/config/suite.js';

const tempDirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('writes a valid suite.yaml and refuses to overwrite without --force', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skilldrift-init-'));
  tempDirs.push(root);
  const skillsDir = join(root, 'skills');
  for (const s of ['b', 'a']) { mkdirSync(join(skillsDir, s), { recursive: true }); writeFileSync(join(skillsDir, s, 'SKILL.md'), '# s'); }
  const suite = join(root, 'suite.yaml');
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await program.parseAsync(['init', '--suite', suite, '--baseline-model', 'base', '--skills-dir', skillsDir], { from: 'user' });
  expect(readSuiteConfig(suite)).toEqual({ baseline_model: 'base', runs: 1, case_generator_model: 'claude-sonnet-5-5' });

  program.exitOverride();
  await expect(program.parseAsync(['init', '--suite', suite, '--baseline-model', 'other'], { from: 'user' })).rejects.toThrow('already exists');
  expect(readFileSync(suite, 'utf8')).toContain('baseline_model: base');

  await program.parseAsync(['init', '--suite', suite, '--baseline-model', 'other', '--skills-dir', skillsDir, '--all-skills', '--force'], { from: 'user' });
  expect(readSuiteConfig(suite)).toEqual({ baseline_model: 'other', skills: ['a', 'b'], runs: 1, case_generator_model: 'claude-sonnet-5-5' });
  expect(existsSync(suite)).toBe(true);
});
