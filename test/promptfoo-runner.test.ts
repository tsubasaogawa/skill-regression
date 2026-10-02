import type { EvaluateResult } from 'promptfoo';
import { afterEach, expect, it, vi } from 'vitest';
import type { SkillCases } from '../src/cases/load.js';
import { JUDGE_PROVIDER } from '../src/config/defaults.js';
import { assertJudgeApiKey, normalize, relocateTmp, runSkill, toTestSuite } from '../src/runner/promptfoo.js';
import { aCase } from './helpers.js';

const rubricSkill: SkillCases = {
  skill: 'demo', dir: '/tmp/demo', source: 'cases.yaml',
  cases: [aCase('quality', { prompt: 'Do the task', assertions: [{ type: 'llm_rubric', rubric: 'The response completes the task.' }] })],
};
const deterministicSkill: SkillCases = { ...rubricSkill, cases: [{ ...rubricSkill.cases[0], assertions: [{ type: 'skill_used' }] }] };
const options = { models: ['claude-sonnet-4-5'], runs: 1, judgeModel: 'claude-haiku-4-5-20251001', workingDir: '/tmp/fixture' };

afterEach(() => vi.unstubAllEnvs());

it('uses Anthropic Messages as the llm-rubric judge', () => {
  const suite = toTestSuite(rubricSkill, options);
  expect(suite.defaultTest).toMatchObject({ options: { provider: `${JUDGE_PROVIDER}:claude-haiku-4-5-20251001` } });
  expect(suite.providers[0].id).toBe('anthropic:claude-agent-sdk');
});

it('requires an Anthropic API key only when llm-rubric assertions are used', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  expect(() => assertJudgeApiKey(rubricSkill)).toThrow(/ANTHROPIC_API_KEY/);
  expect(() => assertJudgeApiKey(deterministicSkill)).not.toThrow();
  await expect(runSkill(rubricSkill, options)).rejects.toThrow(/ANTHROPIC_API_KEY/);
});

it('relocates /tmp into the fixture in prompts and assertions', () => {
  expect(relocateTmp('save to /tmp and /tmp/out.txt, not /tmpfoo or ./tmp or /var/tmp/x', '/fx')).toBe('save to /fx/tmp and /fx/tmp/out.txt, not /tmpfoo or ./tmp or /var/tmp/x');
  const suite = toTestSuite({
    ...rubricSkill,
    cases: [{ ...rubricSkill.cases[0], prompt: 'write /tmp/a.txt', assertions: [{ type: 'file_exists', path: '/tmp/a.txt' }, { type: 'llm_rubric', rubric: 'saved under /tmp' }] }],
  }, { ...options, workingDir: '/fx' });
  expect(suite.tests?.[0]).toMatchObject({
    vars: { prompt: 'write /fx/tmp/a.txt' },
    assert: [{ type: 'javascript', config: { path: '/fx/tmp/a.txt' } }, { type: 'llm-rubric', value: 'saved under /fx/tmp' }],
  });
});

const row = (label: string, desc: string, extra: Partial<EvaluateResult> = {}): EvaluateResult => ({
  promptIdx: 0, testIdx: 0, promptId: 'p', prompt: { raw: '', label: '' }, vars: {},
  testCase: { description: desc }, provider: { id: 'anthropic:claude-agent-sdk', label },
  failureReason: 0, success: true, score: 1, latencyMs: 10, namedScores: {},
  ...extra,
} as EvaluateResult);

it('normalize assigns run_idx per (label, case) in order and derives triggered / judge_dependent', () => {
  const out = normalize([
    row('claude/a', 'c1', { response: { output: '', metadata: { skillCalls: [{ name: 's' }] } }, gradingResult: { pass: true, score: 1, reason: '', componentResults: [{ pass: true, score: 1, reason: '', assertion: { type: 'llm-rubric' } }] } }),
    row('claude/a', 'c1', { response: { output: '', metadata: { skillCalls: [{ name: 's', is_error: true }] } } }),
    row('claude/b', 'c1', { error: 'boom', failureReason: 2, success: false, score: 0 }),
  ], 's', '2.1.282');
  expect(out.map((r) => [r.model, r.run_idx, r.triggered, r.judge_dependent, r.error])).toEqual([
    ['a', 0, true, true, undefined],
    ['a', 1, false, false, undefined],
    ['b', 0, false, false, 'boom'],
  ]);
  expect(out[0].claude_version).toBe('2.1.282');
});

it('normalize tracks deterministic assertion failures separately from rubric failures', () => {
  const mixed = (deterministic: boolean, rubric: boolean) => row('claude/a', 'mixed', {
    success: deterministic && rubric,
    gradingResult: {
      pass: deterministic && rubric, score: 0, reason: '',
      componentResults: [
        { pass: deterministic, score: 0, reason: '', assertion: { type: 'contains', value: 'word' } },
        { pass: rubric, score: 0, reason: '', assertion: { type: 'llm-rubric', value: 'rubric' } },
      ],
    },
  });
  expect(normalize([mixed(false, true), mixed(true, false)], 's').map((r) => ({ passed: r.passed, deterministic: r.deterministic_passed, judge: r.judge_dependent }))).toEqual([
    { passed: false, deterministic: false, judge: true },
    { passed: false, deterministic: true, judge: true },
  ]);
});
