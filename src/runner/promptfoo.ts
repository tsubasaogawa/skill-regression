import { evaluate, ResultFailureReason, type EvaluateResult, type EvaluateSummaryV3, type EvaluateTestSuite } from 'promptfoo';
import { JUDGE_PROVIDER, JUDGE_SYSTEM_PROMPT } from '../config/defaults.js';
import type { SkillCases } from '../cases/load.js';
import { runDir } from '../planner/fixture.js';
import type { Assertion } from '../cases/types.js';
import type { RunResult } from './types.js';

export interface RunOptions {
  models: string[];
  runs: number;
  judgeModel: string;
  /** Root built by buildRunDirs; run i of a case works in runDir(workingDir, case, i). */
  workingDir: string;
  maxConcurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}

export interface RunOutput { results: RunResult[]; raw: EvaluateSummaryV3 }

/**
 * The llm-rubric judge runs on the Claude Code login like the Skill runs, so no ANTHROPIC_API_KEY is needed.
 * Without working_dir the provider uses a temp dir with no tools, and setting_sources defaults to [] (no user settings).
 * A short custom system prompt replaces the Claude Code preset, which would add about 6k input tokens per grading call.
 */
export function judgeProvider(model: string) {
  return { id: JUDGE_PROVIDER, config: { model, apiKeyRequired: false, max_turns: 1, custom_system_prompt: JUDGE_SYSTEM_PROMPT } };
}

/** Rewrite bare /tmp paths into <workingDir>/tmp so parallel skills and repeated runs do not share files. */
export function relocateTmp(text: string, workingDir: string): string {
  return text.replace(/(?<![\w/.-])\/tmp(?![\w-])/g, `${workingDir}/tmp`);
}

export function toAssertion(a: Assertion, skill: string, workingDir: string) {
  const tmp = (s: string) => relocateTmp(s, workingDir);
  switch (a.type) {
    case 'skill_used': return { type: 'skill-used', value: skill };
    case 'skill_not_used': return { type: 'not-skill-used', value: skill };
    case 'regex': return { type: 'regex', value: tmp(a.pattern) };
    case 'contains': return { type: 'icontains', value: tmp(a.value) };
    case 'file_exists': return { type: 'javascript', value: 'file://assets/file_exists.js', config: { path: tmp(a.path), working_dir: workingDir } };
    case 'llm_rubric': return { type: 'llm-rubric', value: tmp(a.rubric) };
  }
}

export function toTestSuite(sc: SkillCases, o: RunOptions): EvaluateTestSuite {
  return {
    prompts: ['{{prompt}}'],
    providers: o.models.map((model) => ({
      id: 'anthropic:claude-agent-sdk', label: `claude/${model}`,
      config: { model, apiKeyRequired: false, setting_sources: ['project'], skills: [sc.skill], permission_mode: 'bypassPermissions', allow_dangerously_skip_permissions: true, allow_all_tools: true },
    })),
    defaultTest: { options: { provider: judgeProvider(o.judgeModel) } },
    // One test per run instead of promptfoo's repeat: runs execute concurrently, so each needs its own working_dir.
    // promptfoo merges test options into the provider config of that call only; the judge never sees working_dir.
    tests: sc.cases.flatMap((c) => Array.from({ length: o.runs }, (_, i) => {
      const dir = runDir(o.workingDir, c.name, i);
      return {
        description: c.name,
        vars: { prompt: relocateTmp(c.prompt, dir) },
        options: { working_dir: dir },
        metadata: { tags: c.tags },
        assert: c.assertions.map((a) => toAssertion(a, sc.skill, dir)),
      };
    })),
  } as EvaluateTestSuite;
}

export function normalize(results: EvaluateResult[], skill: string, claudeVersion?: string): RunResult[] {
  const seen = new Map<string, number>();
  return results.map((r) => {
    const [agent, model] = (r.provider.label ?? r.provider.id ?? '/').split('/', 2);
    const name = r.testCase.description ?? String(r.testIdx);
    const key = `${r.provider.label}\u0000${name}`;
    const run_idx = seen.get(key) ?? 0;
    seen.set(key, run_idx + 1);
    const calls = (r.response?.metadata?.skillCalls ?? []) as { name: string; is_error?: boolean }[];
    const components = r.gradingResult?.componentResults ?? [];
    const error = r.failureReason === ResultFailureReason.ERROR ? (r.error ?? 'provider error') : undefined;
    return {
      skill, case: name, agent, model, run_idx,
      passed: r.success, score: r.score,
      triggered: calls.some((c) => c.name === skill && !c.is_error),
      judge_dependent: components.some((c) => c.assertion?.type === 'llm-rubric'),
      deterministic_passed: components.length ? components.filter((c) => c.assertion?.type !== 'llm-rubric').every((c) => c.pass) : r.success,
      ...(error ? { error } : {}),
      ...(r.success ? {} : { failed_assertions: components.filter((c) => !c.pass).map((c) => c.assertion?.type ?? 'unknown'), excerpt: String(r.response?.output ?? '').slice(0, 300) }),
      ...(r.cost != null ? { cost_usd: r.cost } : {}),
      latency_ms: r.latencyMs,
      ...(claudeVersion ? { claude_version: claudeVersion } : {}),
    };
  });
}

export async function runSkill(sc: SkillCases, o: RunOptions, claudeVersion?: string): Promise<RunOutput> {
  const evalRecord = await evaluate(toTestSuite(sc, o), {
    cache: false, maxConcurrency: o.maxConcurrency ?? 2, silent: true, showProgressBar: false,
    progressCallback: (completed, total) => o.onProgress?.(completed, total),
  });
  const raw = (await evalRecord.toEvaluateSummary()) as EvaluateSummaryV3;
  return { results: normalize(raw.results, sc.skill, claudeVersion), raw };
}

export function runSkillCase(sc: SkillCases, caseName: string, o: RunOptions, claudeVersion?: string): Promise<RunOutput> {
  const testCase = sc.cases.find((c) => c.name === caseName);
  if (!testCase) throw new Error(`case not found: ${sc.skill}/${caseName}`);
  return runSkill({ ...sc, cases: [testCase] }, o, claudeVersion);
}
