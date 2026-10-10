export interface RunResult {
  skill: string;
  case: string;
  agent: string;
  model: string;
  run_idx: number;
  passed: boolean;
  triggered: boolean;
  judge_dependent: boolean;
  deterministic_passed?: boolean;
  error?: string;
  failed_assertions?: string[];
  excerpt?: string;
  cost_usd?: number;
  claude_version?: string;
}
