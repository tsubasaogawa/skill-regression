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

const SUITE_FIELDS = ['baseline_model', 'skills', 'runs', 'aggregate_drop_pt', 'case_generator_model', 'max_cost_usd'];

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function number(value: unknown, label: string, expected: string, ok: (n: number) => boolean): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!ok(n)) throw new Error(`${label} must be ${expected}`);
  return n;
}
const positiveInteger = (v: unknown, label: string) => number(v, label, 'a positive integer', (n) => Number.isInteger(n) && n >= 1);
const dropThreshold = (v: unknown, label: string) => number(v, label, 'between 0 and 1', (n) => n >= 0 && n <= 1);
const nonNegative = (v: unknown, label: string) => number(v, label, 'a non-negative number', (n) => Number.isFinite(n) && n >= 0);
/** YAML numbers must already be numbers; strings like "3" are rejected (NaN fails every check). */
const yamlNumber = (v: unknown) => typeof v === 'number' ? v : Number.NaN;

export function parseSuiteConfig(value: unknown): SuiteConfig {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('suite.yaml must contain a mapping');
  const raw = value as Record<string, unknown>;

  const unknown = Object.keys(raw).filter((key) => !SUITE_FIELDS.includes(key));
  if (unknown.length) throw new Error(`unknown suite.yaml field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);

  const config: SuiteConfig = {};
  if (raw.baseline_model !== undefined) config.baseline_model = nonEmptyString(raw.baseline_model, 'baseline_model');
  if (raw.skills !== undefined) {
    if (!Array.isArray(raw.skills) || !raw.skills.length) throw new Error('skills must be a non-empty list of skill names');
    config.skills = raw.skills.map((skill, i) => nonEmptyString(skill, `skills[${i}]`));
    if (new Set(config.skills).size !== config.skills.length) throw new Error('skills must not contain duplicates');
  }
  if (raw.runs !== undefined) config.runs = positiveInteger(yamlNumber(raw.runs), 'runs');
  if (raw.aggregate_drop_pt !== undefined) config.aggregate_drop_pt = dropThreshold(yamlNumber(raw.aggregate_drop_pt), 'aggregate_drop_pt');
  if (raw.case_generator_model !== undefined) config.case_generator_model = nonEmptyString(raw.case_generator_model, 'case_generator_model');
  if (raw.max_cost_usd !== undefined) config.max_cost_usd = nonNegative(yamlNumber(raw.max_cost_usd), 'max_cost_usd');
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
    throw new Error(`invalid suite config ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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
  promptForModel: (label: string) => Promise<string>,
): Promise<ResolvedCompareConfig> {
  const model = async (flag: string, cliValue: string | undefined, suiteValue: string | undefined, label: string) =>
    cliValue !== undefined ? nonEmptyString(cliValue, flag) : suiteValue ?? nonEmptyString(await promptForModel(label), label.toLowerCase());
  return {
    oldModel: await model('--old', cli.old, suite.baseline_model, 'Baseline model'),
    newModel: await model('--new', cli.new, undefined, 'Candidate model'),
    skills: selectSkills(cli.skill, suite, availableSkills),
    runs: cli.runs === undefined ? suite.runs ?? DEFAULTS.runs : positiveInteger(cli.runs, '--runs'),
    caseGeneratorModel: cli.caseGenerator === undefined ? suite.case_generator_model ?? DEFAULTS.caseGeneratorModel : nonEmptyString(cli.caseGenerator, '--case-generator'),
    aggregateDropPt: cli.aggregateDropPt === undefined ? suite.aggregate_drop_pt : dropThreshold(cli.aggregateDropPt, '--aggregate-drop-pt'),
    maxCostUsd: cli.maxCostUsd === undefined ? suite.max_cost_usd : nonNegative(cli.maxCostUsd, '--max-cost-usd'),
  };
}
