import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillCases } from '../cases/load.js';

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

/** Skill copies, the given input files, assets and an empty tmp/ under `root`. */
function populate(sc: SkillCases, root: string, files: Iterable<string>): void {
  const skipEvals = { recursive: true, filter: (src: string) => !src.startsWith(join(sc.dir, 'evals')) };
  cpSync(sc.dir, join(root, '.claude', 'skills', sc.skill), skipEvals);
  cpSync(sc.dir, join(root, '.agents', 'skills', sc.skill), skipEvals);
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(sc.casesDir ?? sc.dir, f), join(root, f));
  }
  cpSync(ASSETS_DIR, join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'tmp'));
}

/** One working directory holding the input files of every case (`skill-regression fixture`). */
export function buildFixture(sc: SkillCases, fixturesRoot: string): string {
  const root = join(fixturesRoot, sc.skill);
  rmSync(root, { recursive: true, force: true });
  populate(sc, root, new Set(sc.cases.flatMap((c) => c.files)));
  return root;
}

/** Case name as a directory name; a name with characters outside [A-Za-z0-9_-] gets a hash suffix so names stay distinct. */
function caseDirName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return safe === name ? name : `${safe}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
}

/** Working directory of run `runIdx` of a case, under the root returned by buildRunDirs. */
export function runDir(root: string, caseName: string, runIdx: number): string {
  return join(root, caseDirName(caseName), String(runIdx));
}

/**
 * Fresh working directories <fixturesRoot>/<skill>/<case>/<run>/ for `runs` runs of every case. Each holds only that case's
 * input files, so no run sees what another case or run changed or wrote. The paths are deterministic, so prompts that
 * mention them (relocated /tmp) read the same on the old and new sides and across invocations.
 */
export function buildRunDirs(sc: SkillCases, fixturesRoot: string, runs: number): string {
  const root = join(fixturesRoot, sc.skill);
  rmSync(root, { recursive: true, force: true });
  for (const c of sc.cases) {
    for (let i = 0; i < runs; i++) populate(sc, runDir(root, c.name, i), c.files);
  }
  return root;
}
