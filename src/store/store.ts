import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult } from '../runner/types.js';

export interface KeyParts { skill: string; skillHash: string; casesHash: string; model: string; judge: string; runs: number }

export function cacheKey(p: KeyParts): string {
  return createHash('sha256').update(JSON.stringify([p.skill, p.skillHash, p.casesHash, p.model, p.judge, p.runs])).digest('hex').slice(0, 16);
}

export interface StoredResult extends RunResult { key: string; ts: string }

function readJsonl<T>(path: string): T[] {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : [];
}

export class Store {
  constructor(readonly dir: string) { mkdirSync(join(dir, 'raw'), { recursive: true }); }

  lookup(key: string): RunResult[] {
    return readJsonl<StoredResult>(join(this.dir, 'results.jsonl')).filter((r) => r.key === key).map(({ key: _k, ts: _t, ...r }) => r);
  }

  appendResults(key: string, results: RunResult[]): void {
    const ts = new Date().toISOString();
    appendFileSync(join(this.dir, 'results.jsonl'), results.map((r) => JSON.stringify({ ...r, key, ts })).join('\n') + '\n');
  }

  appendVerdict(v: Record<string, unknown>): void {
    appendFileSync(join(this.dir, 'verdicts.jsonl'), JSON.stringify({ ...v, ts: new Date().toISOString() }) + '\n');
  }

  saveRaw(skill: string, raw: unknown): string {
    const p = join(this.dir, 'raw', `${skill}-${Date.now()}.json`);
    writeFileSync(p, JSON.stringify(raw, null, 2));
    return p;
  }
}
