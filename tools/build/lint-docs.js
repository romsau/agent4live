'use strict';

// Run `documentation lint` on all source JS files and filter out the
// stylistic noise that conflicts with eslint-plugin-jsdoc's preferences.
// What remains is the actually-useful signal: parsing surprises, unknown
// tags, structural issues.
//
// The filtered-out warnings:
//   - "object found, Object is standard" — style preference. eslint-plugin-jsdoc
//     enforces lowercase `{object}` (modern JSDoc 4 / TS convention) ; the
//     `documentation` tool prefers uppercase. We follow eslint.
//   - "not reach to EOF" / "unexpected token" — parser quirks of the
//     `documentation` tool on perfectly valid CJS code.

const { execFileSync } = require('child_process');

const NOISE = [/object found, Object is standard/, /not reach to EOF/, /unexpected token/];

const SKIP_LINES = [
  /^Parsing file .*: (?:SyntaxError|TypeError)/, // .html or unparseable JS
  /^⚠ \d+ warnings?$/, // documentation's summary trailer
];

/**
 * Run `documentation lint` and filter out noise. Logs a clean summary or the
 * remaining diagnostics. Exposed for testing ; main entry just calls it.
 */
function lint() {
  let raw = '';
  try {
    raw = execFileSync(
      'npx',
      ['documentation', 'lint', 'app/**/*.js', 'tools/**/*.js'],
      // stdio: pipe captures both stdout and stderr (instead of letting stderr
      // leak through to the terminal) so we can filter parsing-noise lines out
      // before printing.
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err) {
    raw = (err.stdout || '') + (err.stderr || '');
  }

  const lines = raw.split('\n').filter((line) => !SKIP_LINES.some((re) => re.test(line)));

  const filtered = [];
  let currentFile = null;
  let buffer = [];

  for (const line of lines) {
    if (line.match(/^\//) || line.match(/^[A-Z]:\\/)) {
      if (currentFile && buffer.length > 0) filtered.push(currentFile, ...buffer);
      currentFile = line;
      buffer = [];
    } else if (/warning/.test(line) && !NOISE.some((re) => re.test(line))) {
      buffer.push(line);
    }
  }
  if (currentFile && buffer.length > 0) filtered.push(currentFile, ...buffer);

  const warningCount = filtered.filter((l) => /warning/.test(l)).length;
  if (warningCount === 0) {
    console.log('lint:docs — no diagnostic warnings (style noise filtered).');
  } else {
    console.log(filtered.join('\n'));
    console.log(`\n${warningCount} warning(s)`);
  }
}

/* istanbul ignore if -- CLI entry guard, exercised end-to-end via `npm run
   lint:docs`. Sub-process coverage isn't propagated back to Istanbul. */
if (require.main === module) {
  lint();
}

module.exports = { lint };
