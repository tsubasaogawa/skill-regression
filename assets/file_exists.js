// promptfoo javascript assertion: { type: 'javascript', value: 'file://assets/file_exists.js', config: { path, working_dir } }
const fs = require('node:fs');
const path = require('node:path');

module.exports = (_output, context) => {
  const { path: p, working_dir: wd } = context.config;
  const root = path.resolve(wd ?? process.cwd());
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { pass: false, score: 0, reason: `path escapes working_dir: ${p}` };
  if (!fs.existsSync(abs)) return { pass: false, score: 0, reason: `file not found: ${abs}` };
  // ponytail: consume the file so the next repeat of this case cannot pass on a stale output
  fs.rmSync(abs, { recursive: true, force: true });
  return true;
};
