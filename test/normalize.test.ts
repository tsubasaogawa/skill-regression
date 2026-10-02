import { expect, it } from 'vitest';
import type { EvaluateResult } from 'promptfoo';
import { normalize } from '../src/runner/promptfoo.js';

const row = (label: string, desc: string, extra: Partial<EvaluateResult> = {}): EvaluateResult => ({
  promptIdx: 0, testIdx: 0, promptId: 'p', prompt: { raw: '', label: '' }, vars: {},
  testCase: { description: desc }, provider: { id: 'anthropic:claude-agent-sdk', label },
  failureReason: 0, success: true, score: 1, latencyMs: 10, namedScores: {},
  ...extra,
} as EvaluateResult);

it('assigns run_idx per (label, case) in order and derives triggered / judge_dependent', () => {
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

it('tracks deterministic assertion failures separately from rubric failures', () => {
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
  expect(normalize([mixed(false, true), mixed(true, false)], 's').map((r) => ({
    passed: r.passed, deterministic: r.deterministic_passed, judge: r.judge_dependent,
  }))).toEqual([
    { passed: false, deterministic: false, judge: true },
    { passed: false, deterministic: true, judge: true },
  ]);
});
