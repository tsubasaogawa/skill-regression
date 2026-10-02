import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Case, CaseTag } from './types.js';

export const GENERATION_QUOTA: Record<CaseTag, number> = { trigger: 3, 'no-trigger': 2, quality: 3 };

export interface GeneratedItem { tag: CaseTag; prompt: string; rubric?: string }

const SCHEMA = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string', enum: Object.keys(GENERATION_QUOTA) },
          prompt: { type: 'string' },
          rubric: { type: 'string' },
        },
        required: ['tag', 'prompt'],
        additionalProperties: false,
      },
    },
  },
  required: ['cases'],
  additionalProperties: false,
};

export function buildPrompt(skill: string, skillMd: string): string {
  return [
    `You design evaluation cases for the Claude Code skill "${skill}". The SKILL.md is below.`,
    'Produce exactly:',
    `- ${GENERATION_QUOTA.trigger} cases tagged "trigger": realistic user requests that should make the agent invoke this skill. Vary wording; do not quote the skill name or copy the description verbatim.`,
    `- ${GENERATION_QUOTA['no-trigger']} cases tagged "no-trigger": plausible requests on a nearby topic that must NOT invoke this skill.`,
    `- ${GENERATION_QUOTA.quality} cases tagged "quality": requests that invoke the skill, each with a "rubric" describing what a correct response must contain, written so a grader can judge pass or fail from the response text alone.`,
    'Prompts must be self-contained: never reference files or prior context that does not exist. Write prompts in the language the SKILL.md is written in.',
    '', '--- SKILL.md ---', skillMd,
  ].join('\n');
}

export function toCases(items: GeneratedItem[]): Case[] {
  const counts: Record<CaseTag, number> = { trigger: 0, 'no-trigger': 0, quality: 0 };
  const cases = items.map((item): Case => {
    if (!(item.tag in counts)) throw new Error(`generated case has unknown tag: ${String(item.tag)}`);
    if (!item.prompt?.trim()) throw new Error('generated case has an empty prompt');
    const n = ++counts[item.tag];
    const assertions: Case['assertions'] = [{ type: item.tag === 'no-trigger' ? 'skill_not_used' : 'skill_used' }];
    if (item.tag === 'quality') {
      if (!item.rubric?.trim()) throw new Error(`quality case ${n} has no rubric`);
      assertions.push({ type: 'llm_rubric', rubric: item.rubric.trim() });
    }
    return { name: `${item.tag}-${n}`, prompt: item.prompt.trim(), tags: [item.tag], files: [], assertions };
  });
  for (const [tag, want] of Object.entries(GENERATION_QUOTA) as [CaseTag, number][]) {
    if (counts[tag] !== want) throw new Error(`generator returned ${counts[tag]} ${tag} cases, expected ${want}`);
  }
  return cases;
}

export async function generateCases(skill: string, skillDir: string, model: string): Promise<Case[]> {
  const prompt = buildPrompt(skill, readFileSync(join(skillDir, 'SKILL.md'), 'utf8'));
  for await (const msg of query({ prompt, options: { model, tools: [], maxTurns: 1, outputFormat: { type: 'json_schema', schema: SCHEMA } } })) {
    if (msg.type !== 'result') continue;
    if (msg.subtype !== 'success') throw new Error(`case generation failed for ${skill}: ${msg.subtype}`);
    return toCases((msg.structured_output as { cases: GeneratedItem[] }).cases);
  }
  throw new Error(`case generation returned no result for ${skill}`);
}
