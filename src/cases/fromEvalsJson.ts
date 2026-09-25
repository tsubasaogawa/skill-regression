import type { Assertion, Case } from './types.js';

export interface EvalsJson {
  skill_name: string;
  evals: {
    id: number;
    name?: string;
    prompt: string;
    expected_output?: string;
    files?: string[];
    assertions?: string[];
    expectations?: string[];
  }[];
}

const CREATES_RE = /^Creates\s+(\S+)$/i;

export function textToAssertion(text: string): Assertion {
  const m = CREATES_RE.exec(text.trim());
  return m ? { type: 'file_exists', path: m[1] } : { type: 'llm_rubric', rubric: text };
}

export function fromEvalsJson(json: EvalsJson): Case[] {
  return json.evals.map((e) => ({
    name: e.name ?? `eval-${e.id}`,
    prompt: e.prompt,
    tags: ['quality'],
    files: e.files ?? [],
    assertions: [
      { type: 'skill_used' },
      ...(e.expected_output ? [{ type: 'llm_rubric', rubric: e.expected_output } as Assertion] : []),
      ...(e.assertions ?? []).map(textToAssertion),
      ...(e.expectations ?? []).map(textToAssertion),
    ],
  }));
}
