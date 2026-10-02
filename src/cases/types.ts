export type Assertion =
  | { type: 'skill_used' }
  | { type: 'skill_not_used' }
  | { type: 'regex'; pattern: string }
  | { type: 'contains'; value: string }
  | { type: 'file_exists'; path: string }
  | { type: 'llm_rubric'; rubric: string };

export const CASE_TAGS = ['trigger', 'no-trigger', 'quality'] as const;
export type CaseTag = typeof CASE_TAGS[number];

export interface Case {
  name: string;
  prompt: string;
  tags: CaseTag[];
  files: string[];
  assertions: Assertion[];
}
