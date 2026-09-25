export type Assertion =
  | { type: 'skill_used' }
  | { type: 'skill_not_used' }
  | { type: 'regex'; pattern: string }
  | { type: 'contains'; value: string }
  | { type: 'file_exists'; path: string }
  | { type: 'llm_rubric'; rubric: string };

export type CaseTag = 'trigger' | 'no-trigger' | 'quality';

export interface Case {
  name: string;
  prompt: string;
  tags: CaseTag[];
  files: string[];
  assertions: Assertion[];
}
