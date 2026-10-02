import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Case } from '../cases/types.js';
import type { RunResult } from '../runner/types.js';

export interface KeyParts {
  skill: string;
  skillHash: string;
  casesHash: string;
  model: string;
  judge: string;
  runsMax?: number;
  /** @deprecated Use runsMax. Kept for compatibility with existing callers. */
  runs?: number;
}

export function cacheKey(p: KeyParts): string {
  const runsMax = p.runsMax ?? p.runs;
  if (runsMax == null) throw new Error('cache key requires runsMax');
  return createHash('sha256').update(JSON.stringify([p.skill, p.skillHash, p.casesHash, p.model, p.judge, runsMax])).digest('hex').slice(0, 16);
}

export interface StoredResult extends RunResult { key: string; ts: string }
export interface SkillVerdictRow {
  skill: string; agent?: string; old_model: string; new_model: string; case?: string | null;
  verdict: string; flags?: string[]; aggregate?: { old_pass_rate: number; new_pass_rate: number }; ts: string;
}

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

  /** Skill-level verdict rows (case: null), oldest first. */
  skillVerdicts(): SkillVerdictRow[] {
    return readJsonl<SkillVerdictRow>(join(this.dir, 'verdicts.jsonl')).filter((v) => v.case == null).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  appendVerdict(v: Record<string, unknown>): void {
    appendFileSync(join(this.dir, 'verdicts.jsonl'), JSON.stringify({ ...v, ts: new Date().toISOString() }) + '\n');
  }

  generatedPath(skill: string, skillHash: string): string {
    return join(this.dir, 'generated', skill, `${skillHash}.yaml`);
  }

  loadGenerated(skill: string, skillHash: string): Case[] | undefined {
    const p = this.generatedPath(skill, skillHash);
    return existsSync(p) ? (parse(readFileSync(p, 'utf8')) as Case[]) : undefined;
  }

  saveGenerated(skill: string, skillHash: string, cases: Case[]): string {
    const p = this.generatedPath(skill, skillHash);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, stringify(cases));
    return p;
  }

  saveRaw(skill: string, raw: unknown): string {
    const p = join(this.dir, 'raw', `${skill}-${Date.now()}.json`);
    writeFileSync(p, JSON.stringify(raw, null, 2));
    return p;
  }
}
