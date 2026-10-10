import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { program } from '../src/cli.js';
import { runDir } from '../src/planner/fixture.js';
import { runSkill } from '../src/runner/promptfoo.js';
import { aCase, result, silence, tmpRoot, writeSkill } from './helpers.js';

vi.mock('../src/runner/promptfoo.js', () => ({ runSkill: vi.fn(), runSkillCase: vi.fn() }));
vi.mock('../src/runner/version.js', () => ({ cliVersion: vi.fn(() => 'claude-test') }));

let root: string, skillsDir: string;
const base = () => ['compare', '--skills-dir', skillsDir, '--fixtures-dir', join(root, 'fixtures'), '--store', join(root, 'store'), '--out', join(root, 'report'), '--format', 'json', '--suite', join(root, 'none.yaml')];

beforeEach(() => {
  root = tmpRoot();
  skillsDir = join(root, 'skills');
  for (const s of ['a', 'b']) writeSkill(skillsDir, s, [aCase('c')]);
  writeFileSync(join(root, 'none.yaml'), '');
  silence();
  vi.mocked(runSkill).mockImplementation(async (sc, o) => ({
    results: sc.cases.map((c) => result({ skill: sc.skill, case: c.name, model: o.models[0], cost_usd: 2 })),
    raw: {} as never,
  }));
});
afterEach(() => vi.mocked(runSkill).mockReset());

it('exits 3 on missing models in non-interactive mode and on an unknown skill', async () => {
  await expect(program.parseAsync([...base(), '--non-interactive', '--old', 'o'], { from: 'user' })).rejects.toMatchObject({ exitCode: 3, message: expect.stringContaining('Candidate model is required') });
  await expect(program.parseAsync([...base(), '--old', 'o', '--new', 'n', '--skill', 'zzz'], { from: 'user' })).rejects.toMatchObject({ exitCode: 3, message: expect.stringContaining('skill not found') });
  expect(runSkill).not.toHaveBeenCalled();
});

it('stops starting skills once the cost cap is reached and exits 2', async () => {
  await program.parseAsync([...base(), '--old', 'o', '--new', 'n', '--max-cost-usd', '3'], { from: 'user' });
  expect(vi.mocked(runSkill).mock.calls.map(([sc]) => sc.skill)).toEqual(['a', 'a']);
  const report = JSON.parse(readFileSync(join(root, 'report', 'report.json'), 'utf8')) as { exit_code: number; skipped_skills: string[]; skills: { name: string }[] };
  expect(report.skills.map((s) => s.name)).toEqual(['a']);
  expect(report.skipped_skills).toEqual(['b']);
  expect(report.exit_code).toBe(2);
  expect(process.exitCode).toBe(2);
});

it('posts a summary to the webhook', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
  await program.parseAsync([...base(), '--old', 'o', '--new', 'n', '--webhook', 'https://hook.example/x'], { from: 'user' });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://hook.example/x');
  const body = JSON.parse(String((init as RequestInit).body)) as { text: string };
  expect(body.text).toContain('o → n (exit 0)');
  expect(body.text).toContain('- a: UNCHANGED');
  expect(body.text).not.toContain(root);
});

it('logs only the webhook host on failure', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  await program.parseAsync([...base(), '--old', 'o', '--new', 'n', '--webhook', 'https://hook.example/secret/token'], { from: 'user' });
  const lines = err.mock.calls.map((a) => String(a[0]));
  expect(lines.some((l) => l.includes('webhook hook.example failed: boom'))).toBe(true);
  expect(lines.some((l) => l.includes('secret'))).toBe(false);
});

it('rejects invalid run limits, unknown cases and malformed cases with exit 3 before execution', async () => {
  const args = [...base(), '--old', 'o', '--new', 'n'];
  await expect(program.parseAsync([...args, '--runs', '5', '--runs-max', '4'], { from: 'user' })).rejects.toMatchObject({ exitCode: 3 });
  await expect(program.parseAsync([...args, '--case', 'missing'], { from: 'user' })).rejects.toMatchObject({ exitCode: 3 });
  await expect(program.parseAsync([...args, '--concurrency', '0'], { from: 'user' })).rejects.toMatchObject({ exitCode: 3 });
  await expect(program.parseAsync([...args, '--format', 'invalid'], { from: 'user' })).rejects.toMatchObject({ exitCode: 3 });
  writeFileSync(join(skillsDir, 'a', 'evals', 'cases.yaml'), 'not a case list');
  await expect(program.parseAsync(args, { from: 'user' })).rejects.toMatchObject({ exitCode: 3 });
  expect(runSkill).not.toHaveBeenCalled();
});

it('uses candidate cases and input contents on both sides even when baseline evals differ', async () => {
  const oldSkillsDir = join(root, 'old-skills');
  writeSkill(oldSkillsDir, 'a', [aCase('c', { prompt: 'old prompt', tags: [] })], '# old a');
  writeFileSync(join(skillsDir, 'a', 'evals', 'input.txt'), 'candidate input');
  writeSkill(skillsDir, 'a', [aCase('c', { prompt: 'new prompt', files: ['evals/input.txt'] })]);
  const inputs: string[] = [];
  const implementation = vi.mocked(runSkill).getMockImplementation()!;
  vi.mocked(runSkill).mockImplementation(async (sc, opts, version) => {
    inputs.push(readFileSync(join(runDir(opts.workingDir, 'c', 0), 'evals', 'input.txt'), 'utf8'));
    return implementation(sc, opts, version);
  });
  await program.parseAsync([...base(), '--old', 'o', '--new', 'n', '--skill', 'a', '--old-skills-dir', oldSkillsDir], { from: 'user' });
  expect(vi.mocked(runSkill).mock.calls.map(([sc]) => sc.cases[0].prompt)).toEqual(['new prompt', 'new prompt']);
  expect(inputs).toEqual(['candidate input', 'candidate input']);
  writeFileSync(join(skillsDir, 'a', 'evals', 'input.txt'), 'changed candidate input');
  await program.parseAsync([...base(), '--old', 'o', '--new', 'n', '--skill', 'a', '--old-skills-dir', oldSkillsDir], { from: 'user' });
  expect(runSkill).toHaveBeenCalledTimes(4);
  expect(inputs.slice(2)).toEqual(['changed candidate input', 'changed candidate input']);
});
