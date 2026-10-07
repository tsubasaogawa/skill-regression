import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const JUDGE_PROVIDER = 'anthropic:claude-agent-sdk';
export const JUDGE_SYSTEM_PROMPT = 'You are a strict grader. Follow the instructions in the user message exactly and reply with only the requested JSON.';

const xdgDataHome = process.env.XDG_DATA_HOME;
const dataHome = xdgDataHome && isAbsolute(xdgDataHome) ? xdgDataHome : join(homedir(), '.local', 'share');

export const DEFAULTS = {
  suitePath: join(dataHome, 'skilldrift', 'suite.yaml'),
  skillsDir: join(homedir(), '.claude', 'skills'),
  fixturesDir: 'fixtures',
  runs: 3,
  runsMax: 10,
  judgeModel: 'claude-haiku-4-5-20251001',
  caseGeneratorModel: 'claude-sonnet-5-5',
  concurrency: 2,
  store: join(dataHome, 'skilldrift'),
  format: 'both',
} as const;
