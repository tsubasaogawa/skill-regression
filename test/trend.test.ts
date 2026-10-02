import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { program } from '../src/cli.js';
import { tmpRoot } from './helpers.js';

it('lists skill verdicts oldest first, skipping case rows and other skills', async () => {
  const store = tmpRoot();
  const row = (skill: string, newModel: string, verdict: string, ts: string) =>
    JSON.stringify({ skill, agent: 'claude', old_model: 'm1', new_model: newModel, case: null, verdict, flags: [], aggregate: { old_pass_rate: 1, new_pass_rate: 0.8 }, ts });
  writeFileSync(join(store, 'verdicts.jsonl'), [
    row('a', 'm3', 'REGRESSED', '2026-10-02T00:00:00.000Z'),
    JSON.stringify({ skill: 'a', case: 'c1', verdict: 'REGRESSED', ts: '2026-10-02T00:00:00.000Z' }),
    row('a', 'm2', 'UNCHANGED', '2026-10-01T00:00:00.000Z'),
    row('b', 'm2', 'UNCHANGED', '2026-10-01T00:00:00.000Z'),
  ].join('\n') + '\n');
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((s: string) => { out.push(s); });

  await program.parseAsync(['trend', '--store', store, '--skill', 'a', '--format', 'json'], { from: 'user' });
  expect((JSON.parse(out[0]) as { new_model: string }[]).map((v) => v.new_model)).toEqual(['m2', 'm3']);

  await program.parseAsync(['trend', '--store', store], { from: 'user' });
  expect(out[1]).toContain('## a');
  expect(out[1]).toContain('## b');
  expect(out[1]).toContain('| 2026-10-02 00:00 | m1 | m3 | REGRESSED | 100% | 80% |  |');
});
