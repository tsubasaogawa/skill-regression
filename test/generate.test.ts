import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, expect, it, vi } from 'vitest';
import { generateCases, toCases, type GeneratedItem } from '../src/cases/generate.js';
import { hashSkillMd } from '../src/cases/hash.js';
import type { Case } from '../src/cases/types.js';
import { program } from '../src/cli.js';
import { runSkill } from '../src/runner/promptfoo.js';
import { result, silence, tmpRoot, writeSkill } from './helpers.js';

vi.mock('../src/runner/promptfoo.js', () => ({ runSkill: vi.fn() }));
vi.mock('../src/runner/version.js', () => ({ cliVersion: vi.fn(() => 'claude-test') }));
vi.mock('../src/cases/generate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cases/generate.js')>()),
  generateCases: vi.fn(),
}));

const items: GeneratedItem[] = [
  { tag: 'trigger', prompt: 't1' }, { tag: 'trigger', prompt: 't2' }, { tag: 'trigger', prompt: 't3' },
  { tag: 'no-trigger', prompt: 'n1' }, { tag: 'no-trigger', prompt: 'n2' },
  { tag: 'quality', prompt: 'q1', rubric: 'r1' }, { tag: 'quality', prompt: 'q2', rubric: 'r2' }, { tag: 'quality', prompt: 'q3', rubric: 'r3' },
];

afterEach(() => { vi.mocked(generateCases).mockReset(); vi.mocked(runSkill).mockReset(); });

it('converts generated items into neutral cases with trigger assertions', () => {
  const cases = toCases(items);
  expect(cases.map((c) => c.name)).toEqual(['trigger-1', 'trigger-2', 'trigger-3', 'no-trigger-1', 'no-trigger-2', 'quality-1', 'quality-2', 'quality-3']);
  expect(cases[0]).toEqual({ name: 'trigger-1', prompt: 't1', tags: ['trigger'], files: [], assertions: [{ type: 'skill_used' }] });
  expect(cases[3].assertions).toEqual([{ type: 'skill_not_used' }]);
  expect(cases[5].assertions).toEqual([{ type: 'skill_used' }, { type: 'llm_rubric', rubric: 'r1' }]);
  expect(() => toCases(items.slice(1))).toThrow('expected 3');
  expect(() => toCases(items.map((i) => i.tag === 'quality' ? { ...i, rubric: '' } : i))).toThrow('no rubric');
});

it('generates once per skill hash, stores the cases, and shares them between old and new sides', async () => {
  const root = tmpRoot();
  const skillsDir = join(root, 'skills'), oldSkillsDir = join(root, 'old-skills'), storeDir = join(root, 'store');
  for (const dir of [skillsDir, oldSkillsDir]) writeSkill(dir, 'demo', undefined, `---\nname: demo\ndescription: ${dir}\n---\n`);
  const generated = toCases(items);
  vi.mocked(generateCases).mockResolvedValue(generated);
  vi.mocked(runSkill).mockImplementation(async (sc, o) => sc.cases.map((c) => result({ skill: 'demo', case: c.name, model: o.models[0], triggered: c.tags[0] !== 'no-trigger' })));
  silence();

  const args = ['compare', '--skills-dir', skillsDir, '--old-skills-dir', oldSkillsDir, '--fixtures-dir', join(root, 'fixtures'), '--old', 'old-model', '--new', 'new-model', '--runs', '1', '--store', storeDir, '--out', join(root, 'report'), '--format', 'json', '--case-generator', 'gen-model'];
  await program.parseAsync(args, { from: 'user' });

  expect(vi.mocked(generateCases).mock.calls).toEqual([['demo', join(skillsDir, 'demo'), 'gen-model']]);
  const stored = join(storeDir, 'generated', 'demo', `${hashSkillMd(join(skillsDir, 'demo'))}.yaml`);
  expect(existsSync(stored)).toBe(true);
  expect(parse(readFileSync(stored, 'utf8')) as Case[]).toEqual(generated);
  expect(vi.mocked(runSkill).mock.calls.map(([sc, o]) => [o.models[0], sc.cases.map((c) => c.name)])).toEqual([
    ['old-model', generated.map((c) => c.name)],
    ['new-model', generated.map((c) => c.name)],
  ]);
  const report = JSON.parse(readFileSync(join(root, 'report', 'report.json'), 'utf8')) as { skills: { flags: string[]; cases_source: string }[] };
  expect(report.skills[0].cases_source).toBe('generated');
  expect(report.skills[0].flags).toContain('generated-cases');

  writeFileSync(join(skillsDir, 'demo', 'helper.py'), 'changed helper');
  await program.parseAsync([...args, '--no-cache'], { from: 'user' });
  expect(vi.mocked(generateCases)).toHaveBeenCalledTimes(1);

  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out.push(String(chunk)); return true; });
  await program.parseAsync(['cases', 'export', 'demo', '--skills-dir', skillsDir, '--store', storeDir], { from: 'user' });
  expect(parse(out.join('')) as Case[]).toEqual(generated);

  writeFileSync(join(skillsDir, 'demo', 'SKILL.md'), '# Changed Skill');
  await program.parseAsync(args, { from: 'user' });
  expect(generateCases).toHaveBeenCalledTimes(2);
});
