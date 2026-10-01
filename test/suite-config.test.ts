import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parseSuiteConfig, readSuiteConfig, resolveCompareConfig, selectSkills } from '../src/config/suite.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('loads suite.yaml and treats a missing default suite as empty', () => {
  const root = mkdtempSync(join(tmpdir(), 'skilldrift-suite-'));
  tempDirs.push(root);
  const path = join(root, 'suite.yaml');
  writeFileSync(path, 'baseline_model: claude-sonnet\nskills: [alpha, beta]\nruns: 3\naggregate_drop_pt: 0.15\n');

  expect(readSuiteConfig(path)).toEqual({
    baseline_model: 'claude-sonnet',
    skills: ['alpha', 'beta'],
    runs: 3,
    aggregate_drop_pt: 0.15,
  });
  expect(readSuiteConfig(join(root, 'missing.yaml'), true)).toEqual({});
  expect(() => readSuiteConfig(join(root, 'missing.yaml'))).toThrow('suite config not found');
});

it('resolves CLI values before suite values and defaults', async () => {
  const prompt = vi.fn(async () => 'unexpected-model');
  const config = await resolveCompareConfig(
    { old: 'cli-old', new: 'cli-new', skill: 'alpha', runs: '4', aggregateDropPt: '0.2' },
    { baseline_model: 'suite-old', skills: ['beta'], runs: 2, aggregate_drop_pt: 0.1 },
    ['alpha', 'beta'],
    prompt,
  );

  expect(config).toEqual({
    oldModel: 'cli-old',
    newModel: 'cli-new',
    skills: ['alpha'],
    runs: 4,
    aggregateDropPt: 0.2,
  });
  expect(prompt).not.toHaveBeenCalled();
});

it('uses suite values, defaults, then prompts only for missing models', async () => {
  const prompt = vi.fn(async (label: string) => `${label.toLowerCase().replaceAll(' ', '-')}-model`);
  const config = await resolveCompareConfig(
    {},
    { baseline_model: 'suite-old', skills: ['beta'], aggregate_drop_pt: 0.1 },
    ['alpha', 'beta'],
    prompt,
  );

  expect(config).toEqual({
    oldModel: 'suite-old',
    newModel: 'candidate-model-model',
    skills: ['beta'],
    runs: 1,
    aggregateDropPt: 0.1,
  });
  expect(prompt).toHaveBeenCalledOnce();
  expect(prompt).toHaveBeenCalledWith('Candidate model');
});

it('prompts for required models and defaults to all available skills', async () => {
  const prompt = vi.fn(async (label: string) => `${label}-model`);
  const config = await resolveCompareConfig({}, {}, ['alpha', 'beta'], prompt);

  expect(config).toEqual({
    oldModel: 'Baseline model-model',
    newModel: 'Candidate model-model',
    skills: ['alpha', 'beta'],
    runs: 1,
  });
  expect(prompt).toHaveBeenNthCalledWith(1, 'Baseline model');
  expect(prompt).toHaveBeenNthCalledWith(2, 'Candidate model');
});

it('rejects invalid configuration values and unknown skills', () => {
  expect(() => parseSuiteConfig({ runs: 0 })).toThrow('runs must be a positive integer');
  expect(() => parseSuiteConfig({ runs: '3' })).toThrow('runs must be a positive integer');
  expect(() => parseSuiteConfig({ aggregate_drop_pt: 1.1 })).toThrow('aggregate_drop_pt must be between 0 and 1');
  expect(() => parseSuiteConfig({ unexpected: true })).toThrow('unknown suite.yaml field');
  expect(() => selectSkills(undefined, { skills: ['missing'] }, ['available'])).toThrow('skill not found: missing');
});
