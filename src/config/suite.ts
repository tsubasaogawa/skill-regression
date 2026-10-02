import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { DEFAULTS } from './defaults.js';

export interface SuiteConfig {
  baseline_model?: string;
  skills?: string[];
  runs?: number;
  aggregate_drop_pt?: number;
  case_generator_model?: string;
  max_cost_usd?: number;
}

export interface CompareOverrides {
  old?: string;
  new?: string;
  skill?: string;
  runs?: string;
  aggregateDropPt?: string;
  caseGenerator?: string;
  maxCostUsd?: string;
}

export interface ResolvedCompareConfig {
  oldModel: string;
  newModel: string;
  skills: string[];
  runs: number;
  aggregateDropPt?: number;
  caseGeneratorModel: string;
  maxCostUsd?: number;
}

type ModelPrompt = (label: string) => Promise<string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function positiveInteger(value: unknown, label: string): number {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function dropThreshold(value: unknown, label: string): number {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1`);
  return number;
}

function nonNegative(value: unknown, label: string): number {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`);
  return number;
}

export function parseSuiteConfig(value: unknown): SuiteConfig {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error('suite.yaml must contain a mapping');

  const allowed = new Set(['baseline_model', 'skills', 'runs', 'aggregate_drop_pt', 'case_generator_model', 'max_cost_usd']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`unknown suite.yaml field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);

  const config: SuiteConfig = {};
  if (value.baseline_model !== undefined) {
    config.baseline_model = nonEmptyString(value.baseline_model, 'baseline_model');
  }
  if (value.skills !== undefined) {
    if (!Array.isArray(value.skills) || value.skills.length === 0) {
      throw new Error('skills must be a non-empty list of skill names');
    }
    config.skills = value.skills.map((skill, index) => nonEmptyString(skill, `skills[${index}]`));
    if (new Set(config.skills).size !== config.skills.length) throw new Error('skills must not contain duplicates');
  }
  if (value.runs !== undefined) {
    if (typeof value.runs !== 'number') throw new Error('runs must be a positive integer');
    config.runs = positiveInteger(value.runs, 'runs');
  }
  if (value.aggregate_drop_pt !== undefined) {
    if (typeof value.aggregate_drop_pt !== 'number') throw new Error('aggregate_drop_pt must be between 0 and 1');
    config.aggregate_drop_pt = dropThreshold(value.aggregate_drop_pt, 'aggregate_drop_pt');
  }
  if (value.case_generator_model !== undefined) {
    config.case_generator_model = nonEmptyString(value.case_generator_model, 'case_generator_model');
  }
  if (value.max_cost_usd !== undefined) {
    if (typeof value.max_cost_usd !== 'number') throw new Error('max_cost_usd must be a non-negative number');
    config.max_cost_usd = nonNegative(value.max_cost_usd, 'max_cost_usd');
  }
  return config;
}

export function readSuiteConfig(path: string, missingIsEmpty = false): SuiteConfig {
  if (!existsSync(path)) {
    if (missingIsEmpty) return {};
    throw new Error(`suite config not found: ${path}`);
  }
  try {
    return parseSuiteConfig(parse(readFileSync(path, 'utf8')));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid suite config ${path}: ${reason}`, { cause: error });
  }
}

export function selectSkills(cliSkill: string | undefined, suite: SuiteConfig, available: string[]): string[] {
  const selected = cliSkill === undefined ? (suite.skills ?? available) : [nonEmptyString(cliSkill, '--skill')];
  const unknown = selected.filter((skill) => !available.includes(skill));
  if (unknown.length) throw new Error(`skill${unknown.length > 1 ? 's' : ''} not found: ${unknown.join(', ')}`);
  return [...selected];
}

export async function resolveCompareConfig(
  cli: CompareOverrides,
  suite: SuiteConfig,
  availableSkills: string[],
  promptForModel: ModelPrompt,
): Promise<ResolvedCompareConfig> {
  const oldModel = cli.old === undefined
    ? suite.baseline_model ?? nonEmptyString(await promptForModel('Baseline model'), 'baseline model')
    : nonEmptyString(cli.old, '--old');
  const newModel = cli.new === undefined
    ? nonEmptyString(await promptForModel('Candidate model'), 'candidate model')
    : nonEmptyString(cli.new, '--new');
  const runs = cli.runs === undefined
    ? (suite.runs ?? DEFAULTS.runs)
    : positiveInteger(cli.runs, '--runs');
  const aggregateDropPt = cli.aggregateDropPt === undefined
    ? suite.aggregate_drop_pt
    : dropThreshold(cli.aggregateDropPt, '--aggregate-drop-pt');

  const maxCostUsd = cli.maxCostUsd === undefined
    ? suite.max_cost_usd
    : nonNegative(cli.maxCostUsd, '--max-cost-usd');

  return {
    oldModel,
    newModel,
    skills: selectSkills(cli.skill, suite, availableSkills),
    runs,
    caseGeneratorModel: cli.caseGenerator === undefined
      ? (suite.case_generator_model ?? DEFAULTS.caseGeneratorModel)
      : nonEmptyString(cli.caseGenerator, '--case-generator'),
    ...(aggregateDropPt === undefined ? {} : { aggregateDropPt }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
  };
}
