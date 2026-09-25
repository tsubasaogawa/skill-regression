import { describe, expect, it } from 'vitest';
import { fromEvalsJson, textToAssertion } from '../src/cases/fromEvalsJson.js';

describe('textToAssertion', () => {
  it('maps "Creates <path>" to file_exists', () => {
    expect(textToAssertion('Creates /tmp/a.backlog.txt')).toEqual({ type: 'file_exists', path: '/tmp/a.backlog.txt' });
  });
  it('falls back to llm_rubric', () => {
    expect(textToAssertion('The converted file contains {code}')).toEqual({ type: 'llm_rubric', rubric: 'The converted file contains {code}' });
  });
});

describe('fromEvalsJson', () => {
  it('converts assertions and expectations, prepends skill_used, tags quality', () => {
    const cases = fromEvalsJson({
      skill_name: 's',
      evals: [
        { id: 1, prompt: 'p', expected_output: 'eo', files: ['evals/files/x.md'], expectations: ['Creates /tmp/x', 'has table'] },
        { id: 2, name: 'named', prompt: 'q', assertions: ['a1'] },
      ],
    });
    expect(cases).toEqual([
      {
        name: 'eval-1', prompt: 'p', tags: ['quality'], files: ['evals/files/x.md'],
        assertions: [
          { type: 'skill_used' },
          { type: 'llm_rubric', rubric: 'eo' },
          { type: 'file_exists', path: '/tmp/x' },
          { type: 'llm_rubric', rubric: 'has table' },
        ],
      },
      { name: 'named', prompt: 'q', tags: ['quality'], files: [], assertions: [{ type: 'skill_used' }, { type: 'llm_rubric', rubric: 'a1' }] },
    ]);
  });
});
