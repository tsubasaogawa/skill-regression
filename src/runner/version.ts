import { execFileSync } from 'node:child_process';

export function cliVersion(): string | undefined {
  try {
    return execFileSync('claude', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}
