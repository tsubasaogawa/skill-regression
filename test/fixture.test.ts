import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveCases } from '../src/cases/load.js';
import { buildFixture } from '../src/planner/fixture.js';

it('builds fixture with both skill copies, case files and assets', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skilldrift-'));
  const skillDir = join(tmp, 'skills', 's');
  mkdirSync(join(skillDir, 'evals', 'files'), { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# s');
  writeFileSync(join(skillDir, 'evals', 'files', 'in.md'), 'x');
  writeFileSync(join(skillDir, 'evals', 'evals.json'), JSON.stringify({ skill_name: 's', evals: [{ id: 1, prompt: 'p', files: ['evals/files/in.md'] }] }));

  const root = buildFixture(resolveCases(join(tmp, 'skills'), 's'), join(tmp, 'fixtures'));

  for (const f of ['.claude/skills/s/SKILL.md', '.agents/skills/s/SKILL.md', 'evals/files/in.md', 'assets/file_exists.js', 'tmp']) {
    expect(existsSync(join(root, f)), f).toBe(true);
  }
  expect(existsSync(join(root, '.claude/skills/s/evals'))).toBe(false);
});
