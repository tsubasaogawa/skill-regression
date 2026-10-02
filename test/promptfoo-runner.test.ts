import { afterEach, expect, it, vi } from 'vitest';
import { JUDGE_PROVIDER } from '../src/config/defaults.js';
import type { SkillCases } from '../src/cases/load.js';
import { assertJudgeApiKey, relocateTmp, runSkill, toTestSuite } from '../src/runner/promptfoo.js';

const rubricSkill: SkillCases = {
  skill: 'demo',
  dir: '/tmp/demo',
  source: 'cases.yaml',
  cases: [{
    name: 'quality',
    prompt: 'Do the task',
    tags: ['quality'],
    files: [],
    assertions: [{ type: 'llm_rubric', rubric: 'The response completes the task.' }],
  }],
};

const deterministicSkill: SkillCases = {
  ...rubricSkill,
  cases: [{ ...rubricSkill.cases[0], assertions: [{ type: 'skill_used' }] }],
};

afterEach(() => vi.unstubAllEnvs());

it('uses Anthropic Messages as the llm-rubric judge', () => {
  const suite = toTestSuite(rubricSkill, {
    models: ['claude-sonnet-4-5'],
    runs: 1,
    judgeModel: 'claude-haiku-4-5-20251001',
    workingDir: '/tmp/fixture',
  });

  expect(suite.defaultTest).toMatchObject({
    options: { provider: `${JUDGE_PROVIDER}:claude-haiku-4-5-20251001` },
  });
  expect(suite.providers[0].id).toBe('anthropic:claude-agent-sdk');
});

it('requires an Anthropic API key only when llm-rubric assertions are used', () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');

  expect(() => assertJudgeApiKey(rubricSkill)).toThrow(/ANTHROPIC_API_KEY/);
  expect(() => assertJudgeApiKey(deterministicSkill)).not.toThrow();
});

it('rejects rubric runs before calling promptfoo when the API key is missing', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');

  await expect(runSkill(rubricSkill, {
    models: ['claude-sonnet-4-5'],
    runs: 1,
    judgeModel: 'claude-haiku-4-5-20251001',
    workingDir: '/tmp/fixture',
  })).rejects.toThrow(/ANTHROPIC_API_KEY/);
});

it('relocates /tmp into the fixture in prompts and assertions', () => {
  expect(relocateTmp('save to /tmp and /tmp/out.txt, not /tmpfoo or ./tmp or /var/tmp/x', '/fx')).toBe('save to /fx/tmp and /fx/tmp/out.txt, not /tmpfoo or ./tmp or /var/tmp/x');
  const suite = toTestSuite({
    ...rubricSkill,
    cases: [{ ...rubricSkill.cases[0], prompt: 'write /tmp/a.txt', assertions: [{ type: 'file_exists', path: '/tmp/a.txt' }, { type: 'llm_rubric', rubric: 'saved under /tmp' }] }],
  }, { models: ['m'], runs: 1, judgeModel: 'j', workingDir: '/fx' });
  expect(suite.tests?.[0]).toMatchObject({
    vars: { prompt: 'write /fx/tmp/a.txt' },
    assert: [{ type: 'javascript', config: { path: '/fx/tmp/a.txt' } }, { type: 'llm-rubric', value: 'saved under /fx/tmp' }],
  });
});
