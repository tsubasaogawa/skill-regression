import type { EvaluateResult } from 'promptfoo';
import { expect, it } from 'vitest';
import type { SkillCases } from '../src/cases/load.js';
import { JUDGE_SYSTEM_PROMPT } from '../src/config/defaults.js';
import { normalize, relocateTmp, toTestSuite } from '../src/runner/promptfoo.js';
import { aCase } from './helpers.js';

const rubricSkill: SkillCases = {
  skill: 'demo', dir: '/tmp/demo', source: 'cases.yaml',
  cases: [aCase('quality', { prompt: 'Do the task', assertions: [{ type: 'llm_rubric', rubric: 'The response completes the task.' }] })],
};
const options = { models: ['claude-sonnet-4-5'], runs: 1, judgeModel: 'claude-haiku-4-5-20251001', workingDir: '/tmp/fixture' };

it('grades llm-rubric through the Claude Agent SDK on the Claude Code login, without tools or a working dir', () => {
  const suite = toTestSuite(rubricSkill, options);
  expect(suite.defaultTest).toEqual({
    options: {
      provider: {
        id: 'anthropic:claude-agent-sdk',
        config: { model: 'claude-haiku-4-5-20251001', apiKeyRequired: false, max_turns: 1, custom_system_prompt: JUDGE_SYSTEM_PROMPT },
      },
    },
  });
  expect(suite.providers[0].id).toBe('anthropic:claude-agent-sdk');
});

it('relocates /tmp into the fixture in prompts and assertions', () => {
  expect(relocateTmp('save to /tmp and /tmp/out.txt, not /tmpfoo or ./tmp or /var/tmp/x', '/fx')).toBe('save to /fx/tmp and /fx/tmp/out.txt, not /tmpfoo or ./tmp or /var/tmp/x');
  const suite = toTestSuite({
    ...rubricSkill,
    cases: [{ ...rubricSkill.cases[0], prompt: 'write /tmp/a.txt', assertions: [{ type: 'file_exists', path: '/tmp/a.txt' }, { type: 'llm_rubric', rubric: 'saved under /tmp' }] }],
  }, { ...options, workingDir: '/fx' });
  expect(suite.tests?.[0]).toMatchObject({
    vars: { prompt: 'write /fx/quality/0/tmp/a.txt' },
    options: { working_dir: '/fx/quality/0' },
    assert: [{ type: 'javascript', config: { path: '/fx/quality/0/tmp/a.txt', working_dir: '/fx/quality/0' } }, { type: 'llm-rubric', value: 'saved under /fx/quality/0/tmp' }],
  });
});

it('expands runs into one test per run, each with its own working dir, instead of a shared provider working dir', () => {
  const suite = toTestSuite({ ...rubricSkill, cases: [aCase('a', { prompt: 'save /tmp/x' }), aCase('b c', { prompt: 'p' })] }, { ...options, runs: 2, workingDir: '/fx' });
  const tests = suite.tests as { description: string; vars: { prompt: string }; options: { working_dir: string } }[];
  expect(tests.map((t) => [t.description, t.options.working_dir])).toEqual([
    ['a', '/fx/a/0'], ['a', '/fx/a/1'],
    ['b c', expect.stringMatching(/^\/fx\/b_c-[0-9a-f]{8}\/0$/)], ['b c', expect.stringMatching(/^\/fx\/b_c-[0-9a-f]{8}\/1$/)],
  ]);
  expect(tests[1].vars.prompt).toBe('save /fx/a/1/tmp/x');
  expect((suite.providers as { config: Record<string, unknown> }[])[0].config).not.toHaveProperty('working_dir');
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
