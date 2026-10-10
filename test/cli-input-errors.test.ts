import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

it('returns exit 3 for argument parser errors and exit 0 for help', () => {
  for (const args of [['compare', '--unknown'], ['compare', '--old']]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(3);
  }
  const help = spawnSync(process.execPath, ['--import', 'tsx', cli, '--help'], { encoding: 'utf8', timeout: 15_000 });
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain('Usage: skill-regression');
}, 50_000);
