import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { cacheKey, Store } from '../src/store/store.js';
import type { RunResult } from '../src/runner/types.js';

const r: RunResult = { skill: 's', case: 'c', agent: 'claude', model: 'old', run_idx: 0, passed: true, score: 1, triggered: true, judge_dependent: false, latency_ms: 1 };

it('same key hits the cache, different model does not', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'skilldrift-store-')));
  const base = { skill: 's', skillHash: 'a', casesHash: 'b', judge: 'anthropic:messages:j', runsMax: 1 };
  const kOld = cacheKey({ ...base, model: 'old' });
  store.appendResults(kOld, [r]);
  expect(store.lookup(kOld)).toEqual([r]);
  store.appendResults(kOld, [{ ...r, run_idx: 1 }]);
  expect(store.lookup(kOld)).toEqual([r, { ...r, run_idx: 1 }]);
  expect(store.lookup(cacheKey({ ...base, model: 'new' }))).toEqual([]);
  expect(store.lookup(cacheKey({ ...base, model: 'old', runsMax: 2 }))).toEqual([]);
  expect(cacheKey({ ...base, judge: 'anthropic:claude-agent-sdk:j' })).not.toBe(kOld);
});
