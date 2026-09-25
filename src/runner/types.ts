export interface RunResult {
  skill: string;
  case: string;
  agent: string;
  model: string;
  run_idx: number;
  passed: boolean;
  score: number;
  triggered: boolean;
  judge_dependent: boolean;
  error?: string;
  failed_assertions?: string[];
  excerpt?: string;
  cost_usd?: number;
  latency_ms: number;
  claude_version?: string;
}
