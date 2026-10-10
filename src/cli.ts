#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { generateCases } from './cases/generate.js';
import { hashCaseInputs, hashDir, hashSkillMd } from './cases/hash.js';
import { listSkills, resolveCases, validateCases, type SkillCases } from './cases/load.js';
import { compareSkill } from './comparator/verdict.js';
import { DEFAULTS, JUDGE_PROVIDER } from './config/defaults.js';
import { readSuiteConfig, resolveCompareConfig, selectSkills, type CompareOverrides } from './config/suite.js';
import { buildFixture, buildRunDirs } from './planner/fixture.js';
import { buildReport, pct, skillFlags, table, toMarkdown, totalCost, VERSION, type Report, type SkillReport } from './reporter/report.js';
import { runSkill, type RunOptions } from './runner/promptfoo.js';
import type { RunResult } from './runner/types.js';
import { cliVersion } from './runner/version.js';
import { cacheKey, Store } from './store/store.js';

export const program = new Command().name('skilldrift').version(VERSION).exitOverride();

const SIDES = ['old', 'new'] as const;
type Side = typeof SIDES[number];

const INPUT_ERROR = 3;
const inputError = (e: unknown): never => program.error(e instanceof Error ? e.message : String(e), { exitCode: INPUT_ERROR });
const guard = <T>(fn: () => T): T => { try { return fn(); } catch (e) { return inputError(e); } };
const MODEL_HINT: Record<string, string> = { 'Baseline model': 'pass --old or set baseline_model in suite.yaml', 'Candidate model': 'pass --new' };

async function promptForModel(label: string, interactive = true): Promise<string> {
  if (!interactive || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`${label} is required; ${MODEL_HINT[label]}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(`${label}: `)).trim();
    if (!answer) throw new Error(`${label} is required`);
    return answer;
  } finally {
    prompt.close();
  }
}

/** Smallest run count across the given cases. */
function countRuns(results: RunResult[], caseNames: string[]): number {
  return caseNames.length ? Math.min(...caseNames.map((name) => results.filter((r) => r.case === name).length)) : 0;
}

/** First `runs` results of every case. */
function limitRuns(results: RunResult[], runs: number): RunResult[] {
  const seen = new Map<string, number>();
  return results.filter((r) => {
    const count = seen.get(r.case) ?? 0;
    seen.set(r.case, count + 1);
    return count < runs;
  });
}

/** Continue run_idx numbering after the results already held for each case. */
function reindexResults(existing: RunResult[], fresh: RunResult[]): RunResult[] {
  const next = new Map<string, number>();
  for (const r of existing) next.set(r.case, Math.max(next.get(r.case) ?? 0, r.run_idx + 1));
  return fresh.map((r) => {
    const run_idx = next.get(r.case) ?? 0;
    next.set(r.case, run_idx + 1);
    return { ...r, run_idx };
  });
}

/** Cases for a skill; generated ones come from the store, or from `generator` when not stored yet. */
async function loadSkill(store: Store, dir: string, skill: string, generator?: string): Promise<SkillCases> {
  const sc = resolveCases(dir, skill);
  if (sc.source !== 'generated') return sc;
  const hash = hashSkillMd(sc.dir);
  let cases = store.loadGenerated(skill, hash);
  if (!cases && generator) {
    console.error(`${skill}: generating cases with ${generator}`);
    cases = await generateCases(skill, sc.dir, generator);
    console.error(`${skill}: saved generated cases to ${store.saveGenerated(skill, hash, cases)}`);
  }
  return { ...sc, cases: cases ? validateCases(cases, sc.dir) : [] };
}

interface CompareOpts extends CompareOverrides {
  suite?: string; skillsDir: string; fixturesDir: string; case?: string; oldSkillsDir?: string; runsMax?: string;
  llmRubric: boolean; judge: string; concurrency: string; store: string; cache: boolean; nonInteractive?: boolean;
  webhook?: string; out?: string; format: string; dryRun?: boolean;
}

program
  .command('compare')
  .description('Compare skill behaviour between two models')
  .option('--suite <file>', `suite configuration file (default: ${DEFAULTS.suitePath})`)
  .option('--skills-dir <dir>', 'skills directory', DEFAULTS.skillsDir)
  .option('--fixtures-dir <dir>', 'fixtures root', DEFAULTS.fixturesDir)
  .option('--skill <name>', 'only this skill')
  .option('--case <name>', 'only this case')
  .option('--old <model>', 'baseline model')
  .option('--new <model>', 'candidate model')
  .option('--old-skills-dir <dir>', 'skills directory for the baseline side (default: --skills-dir)')
  .option('--runs <n>', 'runs per case per model')
  .option('--runs-max <n>', `maximum runs per case per model (default: max(${DEFAULTS.runsMax}, --runs))`)
  .option('--no-llm-rubric', 'drop llm_rubric assertions and grade with deterministic assertions only')
  .option('--judge <model>', 'judge model for llm_rubric', DEFAULTS.judgeModel)
  .option('--case-generator <model>', 'model that generates cases for skills without evals (default: suite case_generator_model)')
  .option('--concurrency <n>', 'max concurrent runs', String(DEFAULTS.concurrency))
  .option('--store <dir>', 'store directory', DEFAULTS.store)
  .option('--aggregate-drop-pt <n>', 'aggregate pass-rate drop (0-1) at which a skill without regressed cases is DEGRADED')
  .option('--no-cache', 'rerun even if results for the same key exist')
  .option('--non-interactive', 'never prompt; exit 3 when a required value is missing')
  .option('--max-cost-usd <n>', 'stop starting new skills once reported cost reaches this amount (default: suite max_cost_usd)')
  .option('--webhook <url>', 'POST a summary to this URL (default: SKILLDRIFT_WEBHOOK_URL)')
  .option('--out <dir>', 'report directory (default: <store>/reports/claude/<new-model>/<timestamp>)')
  .option('--format <fmt>', 'md | json | both', DEFAULTS.format)
  .option('--dry-run', 'list skills and resolved cases without running')
  .action(compare);

async function compare(opts: CompareOpts): Promise<void> {
  const { suite, availableSkills, selectedSkills } = guard(() => {
    const suite = readSuiteConfig(opts.suite ?? DEFAULTS.suitePath, opts.suite === undefined);
    const availableSkills = listSkills(opts.skillsDir);
    return { suite, availableSkills, selectedSkills: selectSkills(opts.skill, suite, availableSkills) };
  });
  const store = new Store(opts.store);
  const resolveSkill = async (dir: string, skill: string, generator?: string): Promise<SkillCases> => {
    const sc = await loadSkill(store, dir, skill, generator);
    const cases = opts.llmRubric ? sc.cases : sc.cases.map((c) => ({ ...c, assertions: c.assertions.filter((a) => a.type !== 'llm_rubric') }));
    return { ...sc, cases: cases.filter((c) => !opts.case || c.name === opts.case) };
  };

  if (opts.dryRun) {
    const skills = await Promise.all(selectedSkills.map((s) => resolveSkill(opts.skillsDir, s))).catch(inputError);
    if (opts.case && !skills.some((s) => s.cases.length)) return inputError(`case not found: ${opts.case}`);
    for (const s of skills) console.log(`${s.skill.padEnd(36)} ${String(s.cases.length).padStart(3)} cases (${s.source}${s.source === 'generated' && !s.cases.length ? ', pending' : ''})`);
    console.log(`\n${skills.length} skills, ${skills.reduce((n, s) => n + s.cases.length, 0)} cases`);
    return;
  }

  const config = await resolveCompareConfig(opts, suite, availableSkills, (label) => promptForModel(label, !opts.nonInteractive)).catch(inputError);
  const { oldModel, newModel, runs } = config;
  const runsMax = opts.runsMax == null ? Math.max(DEFAULTS.runsMax, runs) : Number(opts.runsMax);
  if (!Number.isInteger(runsMax) || runsMax < runs) return inputError('--runs-max must be an integer greater than or equal to --runs');
  if (!Number.isInteger(Number(opts.concurrency)) || Number(opts.concurrency) < 1) return inputError('--concurrency must be a positive integer');
  if (!['md', 'json', 'both'].includes(opts.format)) return inputError('--format must be md, json or both');
  const resolvedSkills = await Promise.all(config.skills.map(async (name) => {
    const sc = await resolveSkill(opts.skillsDir, name);
    const oldDir = join(opts.oldSkillsDir ?? opts.skillsDir, name);
    if (!existsSync(join(oldDir, 'SKILL.md'))) throw new Error(`baseline skill not found: ${name}`);
    return sc;
  })).catch(inputError);
  if (opts.case && !resolvedSkills.some((s) => s.cases.length || s.source === 'generated')) return inputError(`case not found: ${opts.case}`);
  const claudeVersion = cliVersion();
  const startedAt = new Date();
  const sides = { old: { model: oldModel, dir: opts.oldSkillsDir ?? opts.skillsDir }, new: { model: newModel, dir: opts.skillsDir } };
  const all = { old: [] as RunResult[], new: [] as RunResult[] };
  const reports: SkillReport[] = [];
  const skipped: string[] = [];
  let spent = 0;

  for (const name of config.skills) {
    if (config.maxCostUsd !== undefined && spent >= config.maxCostUsd) { skipped.push(name); continue; }
    const pending = resolvedSkills.find((s) => s.skill === name)!;
    const scNew = pending.source === 'generated' ? await resolveSkill(sides.new.dir, name, config.caseGeneratorModel).catch(inputError) : pending;
    if (!scNew.cases.length) continue;
    const sc: Record<Side, SkillCases> = {
      old: { ...scNew, dir: join(sides.old.dir, name), casesDir: scNew.dir },
      new: scNew,
    };
    const keyOf = (side: Side) => cacheKey({ skill: name, skillHash: hashDir(sc[side].dir), casesHash: hashCaseInputs(scNew.cases, scNew.dir), model: sides[side].model, judge: `${JUDGE_PROVIDER}:${opts.judge}`, runsMax });
    const keys: Record<Side, string> = { old: keyOf('old'), new: keyOf('new') };
    const shared = keys.old === keys.new;
    const results: Record<Side, RunResult[]> = { old: [], new: [] };

    const runFresh = async (side: Side, repeat: number, caseName?: string) => {
      const label = [name, side, caseName].filter(Boolean).join(' ');
      const planned = caseName ? { ...sc[side], cases: sc[side].cases.filter((c) => c.name === caseName) } : sc[side];
      const o: RunOptions = {
        models: [sides[side].model], runs: repeat, judgeModel: opts.judge, workingDir: resolve(buildRunDirs(planned, opts.fixturesDir, repeat)),
        maxConcurrency: Number(opts.concurrency), onProgress: (c, t) => console.error(`${label}: ${c}/${t}`),
      };
      const appended = reindexResults(results[side], await runSkill(planned, o, claudeVersion));
      spent += totalCost(appended);
      store.appendResults(keys[side], appended);
      results[side].push(...appended);
    };
    const ensureRuns = async (side: Side, target: number, caseName?: string) => {
      const needed = target - countRuns(results[side], caseName ? [caseName] : sc[side].cases.map((c) => c.name));
      if (needed > 0) await runFresh(side, needed, caseName);
    };

    for (const side of SIDES) {
      if (side === 'new' && shared) {
        results.new = results.old;
        console.error(`${name}: new side shares the old side results (${keys.new})`);
        continue;
      }
      const cached = opts.cache ? store.lookup(keys[side]) : [];
      if (cached.length) {
        console.error(`${name}: ${side} (${sides[side].model}) cached (${keys[side]})`);
        const versions = [...new Set(cached.map((r) => r.claude_version).filter(Boolean))];
        if (claudeVersion && versions.some((v) => v !== claudeVersion)) console.error(`${name}: ${side} cache was recorded with claude ${versions.join(', ')} but current is ${claudeVersion}; pass --no-cache to rerun`);
        results[side] = cached;
      }
      await ensureRuns(side, runs);
    }

    const caseNames = [...new Set([...sc.old.cases, ...sc.new.cases].map((c) => c.name))];
    const tagsOf = (c: string) => scNew.cases.find((x) => x.name === c)?.tags ?? [];
    let totalRuns = Math.min(runsMax, countRuns(results.old, caseNames), countRuns(results.new, caseNames));
    const compareCurrent = () => compareSkill(name, limitRuns(results.old, totalRuns || Infinity), limitRuns(results.new, totalRuns || Infinity), tagsOf, config.aggregateDropPt);
    let comparison = compareCurrent();
    while (totalRuns < runsMax) {
      const ambiguous = comparison.cases.filter((c) => c.needsMoreRuns).map((c) => c.name);
      if (!ambiguous.length) break;
      totalRuns = Math.min(runsMax, totalRuns + runs);
      for (const caseName of ambiguous) {
        for (const side of SIDES) {
          if (side === 'new' && shared) continue;
          await ensureRuns(side, totalRuns, caseName);
        }
      }
      comparison = compareCurrent();
    }

    const sr: SkillReport = { ...comparison, flags: skillFlags(comparison, scNew.source), cases_source: scNew.source };
    store.appendVerdict({ skill: name, agent: 'claude', old_model: oldModel, new_model: newModel, case: null, verdict: sr.verdict, flags: sr.flags, aggregate: sr.aggregate, trigger: sr.trigger, keys });
    all.old.push(...results.old);
    all.new.push(...results.new);
    reports.push(sr);
  }

  if (opts.case && !reports.length && !skipped.length) return inputError(`case not found: ${opts.case}`);
  if (skipped.length) console.error(`cost cap $${config.maxCostUsd} reached after $${spent.toFixed(2)}; skipped: ${skipped.join(', ')}`);
  const report = buildReport(reports, all, { oldModel, newModel, startedAt, claudeVersion, skipped });
  const out = opts.out ?? join(opts.store, 'reports', 'claude', newModel, startedAt.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  if (opts.format !== 'json') writeFileSync(join(out, 'report.md'), toMarkdown(report));
  if (opts.format !== 'md') writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (opts.format === 'json') console.log(JSON.stringify(report, null, 2));
  else { console.log(toMarkdown(report, termWidth())); console.error(`report: ${out}`); }
  process.exitCode = report.exit_code;
  const webhook = opts.webhook ?? process.env.SKILLDRIFT_WEBHOOK_URL;
  if (webhook) await postWebhook(webhook, report);
}

const termWidth = () => process.stdout.isTTY ? process.stdout.columns : undefined;

async function postWebhook(url: string, report: Report): Promise<void> {
  const text = [
    `skilldrift: ${report.old_model} → ${report.new_model} (exit ${report.exit_code})`,
    ...report.skills.map((s) => `- ${s.name}: ${s.verdict}${s.flags.length ? ` [${s.flags.join(', ')}]` : ''}`),
    ...(report.skipped_skills?.length ? [`skipped (cost cap): ${report.skipped_skills.join(', ')}`] : []),
  ].join('\n');
  const host = URL.canParse(url) ? new URL(url).host : 'invalid url';
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) console.error(`webhook ${host} responded ${res.status}`);
  } catch (e) {
    console.error(`webhook ${host} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

program
  .command('cases')
  .command('export')
  .argument('<skill>', 'skill name')
  .description('Print resolved cases of a skill as neutral-format YAML')
  .option('--skills-dir <dir>', 'skills directory', DEFAULTS.skillsDir)
  .option('--store <dir>', 'store directory holding generated cases', DEFAULTS.store)
  .action(async (skill: string, opts: { skillsDir: string; store: string }) => {
    const sc = await loadSkill(new Store(opts.store), opts.skillsDir, skill).catch(inputError);
    if (!sc.cases.length) return inputError(`no generated cases for ${skill}; run compare first`);
    process.stdout.write(stringify(sc.cases));
  });

export function suiteTemplate(o: { baselineModel: string; skills: string[] }): string {
  return [
    '# skilldrift suite configuration (see docs/configuration.md)',
    `baseline_model: ${o.baselineModel}`,
    '',
    '# Skills to compare. Omit to compare every skill under --skills-dir.',
    ...(o.skills.length ? ['skills:', ...o.skills.map((s) => `  - ${s}`)] : ['# skills: []']),
    '',
    `runs: ${DEFAULTS.runs}`,
    '# aggregate_drop_pt: 0.1    # pass-rate drop (0-1) that marks a skill DEGRADED',
    `case_generator_model: ${DEFAULTS.caseGeneratorModel}`,
    '',
  ].join('\n');
}

program
  .command('init')
  .description('Write a suite.yaml template')
  .option('--suite <file>', 'output file', DEFAULTS.suitePath)
  .option('--baseline-model <model>', 'baseline model (prompted if omitted)')
  .option('--skills-dir <dir>', 'skills directory used to list skills', DEFAULTS.skillsDir)
  .option('--all-skills', 'write every skill under --skills-dir explicitly instead of omitting skills')
  .option('--force', 'overwrite an existing file')
  .action(async (opts: { suite: string; baselineModel?: string; skillsDir: string; allSkills?: boolean; force?: boolean }) => {
    if (existsSync(opts.suite) && !opts.force) return inputError(`${opts.suite} already exists; pass --force to overwrite`);
    const baselineModel = opts.baselineModel ?? await promptForModel('Baseline model').catch(inputError);
    const skills = guard(() => opts.allSkills ? listSkills(opts.skillsDir) : []);
    mkdirSync(dirname(opts.suite), { recursive: true });
    writeFileSync(opts.suite, suiteTemplate({ baselineModel, skills }));
    console.error(`wrote ${opts.suite}`);
  });

program
  .command('trend')
  .description('List skill verdict history from the store, oldest first')
  .option('--store <dir>', 'store directory', DEFAULTS.store)
  .option('--skill <name>', 'only this skill')
  .option('--agent <name>', 'only this agent', 'claude')
  .option('--format <fmt>', 'md | json', 'md')
  .action((opts: { store: string; skill?: string; agent: string; format: string }) => {
    if (!['md', 'json'].includes(opts.format)) return inputError('--format must be md or json');
    const rows = new Store(opts.store).skillVerdicts()
      .filter((v) => (v.agent ?? 'claude') === opts.agent && (!opts.skill || v.skill === opts.skill));
    if (opts.format === 'json') return console.log(JSON.stringify(rows, null, 2));
    const lines = [...new Set(rows.map((v) => v.skill))].flatMap((skill) => [
      `## ${skill}`, '',
      ...table(['When', 'Old', 'New', 'Verdict', 'Old pass', 'New pass', 'Flags'],
        rows.filter((v) => v.skill === skill).map((v) => [v.ts.slice(0, 16).replace('T', ' '), v.old_model, v.new_model, v.verdict, pct(v.aggregate?.old_pass_rate), pct(v.aggregate?.new_pass_rate), (v.flags ?? []).join(', ')]), termWidth()),
      '',
    ]);
    console.log(lines.length ? lines.join('\n') : 'no verdicts');
  });

program
  .command('fixture')
  .argument('<skill>', 'skill name')
  .description('Build fixtures/<skill>/ working directory')
  .option('--skills-dir <dir>', 'skills directory', DEFAULTS.skillsDir)
  .option('--fixtures-dir <dir>', 'fixtures root', DEFAULTS.fixturesDir)
  .action((skill: string, opts: { skillsDir: string; fixturesDir: string }) => {
    console.log(buildFixture(guard(() => resolveCases(opts.skillsDir, skill)), opts.fixturesDir));
  });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await program.parseAsync();
  } catch (e) {
    if (!(e instanceof CommanderError)) throw e;
    process.exit(e.exitCode === 0 ? 0 : INPUT_ERROR);
  }
}
