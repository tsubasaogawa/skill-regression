import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULTS = {
  suitePath: 'suite.yaml',
  skillsDir: join(homedir(), '.claude', 'skills'),
  fixturesDir: 'fixtures',
  runs: 1,
  judgeModel: 'claude-haiku-4-5-20251001',
  concurrency: 2,
  store: '.skilldrift',
  format: 'both',
} as const;
