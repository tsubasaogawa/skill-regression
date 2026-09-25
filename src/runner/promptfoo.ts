import { tmpdir } from 'node:os';
import { evaluate, ResultFailureReason, type EvaluateResult, type EvaluateSummaryV3, type EvaluateTestSuite } from 'promptfoo';
import type { SkillCases } from '../cases/load.js';
import type { Assertion } from '../cases/types.js';
import type { RunResult } from './types.js';

export interface RunOptions {
  models: string[];
  runs: number;
  judgeModel: string;
  workingDir: string;
  maxConcurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}

export function toAssertion(a: Assertion, skill: string, workingDir: string) {
  switch (a.type) {
    case 'skill_used': return { type: 'skill-used', value: skill };
    case 'skill_not_used': return { type: 'not-skill-used', value: skill };
    case 'regex': return { type: 'regex', value: a.pattern };
    case 'contains': return { type: 'icontains', value: a.value };
    case 'file_exists': return { type: 'javascript', value: 'file://assets/file_exists.js', config: { path: a.path, working_dir: workingDir } };
    case 'llm_rubric': return { type: 'llm-rubric', value: a.rubric };
  }
}

export function toTestSuite(sc: SkillCases, o: RunOptions): EvaluateTestSuite {
  const agentSdk = (model: string, config: object) => ({ id: 'anthropic:claude-agent-sdk', label: `claude/${model}`, config: { model, apiKeyRequired: false, ...config } });
  return {
    prompts: ['{{prompt}}'],
    providers: o.models.map((m) => agentSdk(m, { working_dir: o.workingDir, setting_sources: ['project'], skills: [sc.skill], permission_mode: 'bypassPermissions', allow_dangerously_skip_permissions: true, allow_all_tools: true })),
    // ponytail: judge via agent-sdk so Claude Code login suffices; switch to anthropic:messages when an API key is available
    defaultTest: { options: { provider: agentSdk(o.judgeModel, { working_dir: tmpdir(), tools: [] }) } },
    tests: sc.cases.map((c) => ({
      description: c.name,
      vars: { prompt: c.prompt },
      metadata: { tags: c.tags },
      assert: c.assertions.map((a) => toAssertion(a, sc.skill, o.workingDir)),
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
      ...(error ? { error } : {}),
      ...(r.success ? {} : { failed_assertions: components.filter((c) => !c.pass).map((c) => c.assertion?.type ?? 'unknown'), excerpt: String(r.response?.output ?? '').slice(0, 300) }),
      ...(r.cost != null ? { cost_usd: r.cost } : {}),
      latency_ms: r.latencyMs,
      ...(claudeVersion ? { claude_version: claudeVersion } : {}),
    };
  });
}

export async function runSkill(sc: SkillCases, o: RunOptions, claudeVersion?: string): Promise<{ results: RunResult[]; raw: EvaluateSummaryV3 }> {
  const evalRecord = await evaluate(toTestSuite(sc, o), {
    repeat: o.runs, cache: false, maxConcurrency: o.maxConcurrency ?? 2, silent: true, showProgressBar: false,
    progressCallback: (completed, total) => o.onProgress?.(completed, total),
  });
  const raw = (await evalRecord.toEvaluateSummary()) as EvaluateSummaryV3;
  return { results: normalize(raw.results, sc.skill, claudeVersion), raw };
}
