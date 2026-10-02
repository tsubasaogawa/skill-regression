import { expect, it } from 'vitest';
import { cacheKey, Store } from '../src/store/store.js';
import { result, tmpRoot } from './helpers.js';

it('same key hits the cache, different model does not', () => {
  const store = new Store(tmpRoot());
  const r = result({ model: 'old' });
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
