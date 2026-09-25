import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillCases } from '../cases/load.js';

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export function buildFixture(sc: SkillCases, fixturesRoot: string): string {
  const root = join(fixturesRoot, sc.skill);
  rmSync(root, { recursive: true, force: true });
  const skipEvals = { recursive: true, filter: (src: string) => !src.startsWith(join(sc.dir, 'evals')) };
  cpSync(sc.dir, join(root, '.claude', 'skills', sc.skill), skipEvals);
  cpSync(sc.dir, join(root, '.agents', 'skills', sc.skill), skipEvals);
  for (const f of new Set(sc.cases.flatMap((c) => c.files))) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(sc.dir, f), join(root, f));
  }
  cpSync(ASSETS_DIR, join(root, 'assets'), { recursive: true });
  return root;
}
