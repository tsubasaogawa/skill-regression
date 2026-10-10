import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Case } from './types.js';

/** Hash of every file under a skill directory except evals/, which only holds cases. */
export function hashDir(dir: string): string {
  const h = createHash('sha256');
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)))
    .filter((p) => p.split(sep)[0] !== 'evals')
    .sort();
  for (const p of files) h.update(p).update('\0').update(readFileSync(join(dir, p))).update('\0');
  return h.digest('hex');
}

export function hashSkillMd(dir: string): string {
  return createHash('sha256').update(readFileSync(join(dir, 'SKILL.md'))).digest('hex');
}

/** Include the contents of inputs as well as their names in execution cache keys. */
export function hashCaseInputs(cases: Case[], dir: string): string {
  const h = createHash('sha256').update(JSON.stringify(cases));
  for (const file of [...new Set(cases.flatMap((c) => c.files))].sort()) {
    h.update('\0').update(file).update('\0').update(readFileSync(join(dir, file)));
  }
  return h.digest('hex');
}
