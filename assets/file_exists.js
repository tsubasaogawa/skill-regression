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
  // each run has its own working_dir, so the file is left in place for inspection
  return true;
};
