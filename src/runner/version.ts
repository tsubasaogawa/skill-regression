import { execFileSync } from 'node:child_process';

export function cliVersion(bin: 'claude' | 'codex'): string | undefined {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}
