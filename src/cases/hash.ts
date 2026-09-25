import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Case } from './types.js';

export function hashDir(dir: string, skip: string[] = ['evals']): string {
  const h = createHash('sha256');
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .filter((p) => !skip.includes(relative(dir, p).split('/')[0]))
    .sort();
  for (const p of files) h.update(relative(dir, p)).update('\0').update(readFileSync(p)).update('\0');
  return h.digest('hex');
}

export function hashCases(cases: Case[]): string {
  return createHash('sha256').update(JSON.stringify(cases)).digest('hex');
}
