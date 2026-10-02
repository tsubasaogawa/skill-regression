// promptfoo javascript assertion: { type: 'javascript', value: 'file://assets/file_exists.js', config: { path, working_dir } }
const fs = require('node:fs');
const path = require('node:path');

module.exports = (_output, context) => {
  const { path: p, working_dir: wd } = context.config;
  const abs = path.isAbsolute(p) ? p : path.join(wd ?? process.cwd(), p);
  if (!fs.existsSync(abs)) return { pass: false, score: 0, reason: `file not found: ${abs}` };
  // ponytail: consume the file so the next repeat of this case cannot pass on a stale output
  fs.rmSync(abs, { recursive: true, force: true });
  return true;
};
