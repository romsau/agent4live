'use strict';

// Generate Markdown API docs from JSDoc annotations. One .md per logical
// domain so the output stays navigable instead of a single 4500-line file
// with a TOC dominated by colliding `register()` symbols.
//
// Output : docs/api/<domain>.md  +  docs/api/README.md (index).
// Run    : npm run docs

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(REPO, 'docs', 'api');

/**
 * Enumerate .js files matching a directory (optionally recursive).
 *
 * @param {string} dir - relative to repo root.
 * @param {boolean} recursive
 * @returns {string[]} Absolute paths.
 */
function jsFiles(dir, recursive) {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory() && recursive) {
      out.push(...jsFiles(path.join(dir, entry.name), true));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path.join(REPO, dir, entry.name));
    }
  }
  return out;
}

// Each entry → one .md file. `files` is built dynamically from the FS.
const DOMAINS = [
  {
    slug: 'lom_router',
    label: 'LOM router (Max [js] handlers)',
    files: () => jsFiles('app/lom_router'),
  },
  {
    slug: 'server-core',
    label: 'Server core (HTTP / MCP / SSE / UI / discovery)',
    files: () =>
      [
        ...jsFiles('app/server/lom'),
        ...jsFiles('app/server/mcp'),
        ...jsFiles('app/server/ui'),
        path.join(REPO, 'app/server/index.js'),
        path.join(REPO, 'app/server/config.js'),
        path.join(REPO, 'app/server/discovery.js'),
        path.join(REPO, 'app/index.js'),
      ].filter((p) => fs.existsSync(p)),
  },
  {
    slug: 'tools-define',
    label: 'Tools framework (defineTool helper)',
    files: () => [path.join(REPO, 'app/server/tools/define.js')],
  },
  {
    slug: 'tools-tracks',
    label: 'Track tools',
    files: () => jsFiles('app/server/tools/tracks'),
  },
  {
    slug: 'tools-clips',
    label: 'Clip tools',
    files: () => jsFiles('app/server/tools/clips'),
  },
  {
    slug: 'tools-other',
    label:
      'Other tool families (raw / session / transport / scenes / arrangement / application / racks / instruments)',
    files: () =>
      [
        'raw',
        'session',
        'transport',
        'scenes',
        'arrangement',
        'application',
        'racks',
        'instruments',
      ].map((f) => path.join(REPO, 'app/server/tools/' + f + '.js')),
  },
  {
    slug: 'build-tools',
    label: 'Build + dev tooling',
    files: () => [...jsFiles('tools/build'), ...jsFiles('tools/dev-server')],
  },
];

/**
 * Generate one markdown file per domain (under docs/api/) plus an index
 * README.md. Skips domains whose source files don't exist on disk.
 */
function generate() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const indexLines = [
    '# agent4live — API reference',
    '',
    'Auto-generated from JSDoc annotations by `npm run docs`. Source of truth is',
    'the code itself ; this file is regenerated on every doc build.',
    '',
    '## Domains',
    '',
  ];

  for (const d of DOMAINS) {
    const files = d.files().filter((p) => fs.existsSync(p));
    if (files.length === 0) {
      console.log('  · ' + d.slug + ' — no files matched, skipped');
      continue;
    }
    const outFile = path.join(OUT_DIR, d.slug + '.md');
    console.log('  → ' + d.slug + ' (' + files.length + ' files)');
    const md = execFileSync('npx', ['documentation', 'build', ...files, '-f', 'md', '--shallow'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    fs.writeFileSync(outFile, md);
    indexLines.push('- [' + d.label + '](' + d.slug + '.md)');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), indexLines.join('\n') + '\n');
  console.log('  → README.md');
  console.log('Done. ' + DOMAINS.length + ' domain files + index.');
}

/* istanbul ignore if -- CLI entry guard, exercised end-to-end via `npm run
   docs`. Sub-process coverage isn't propagated back to the parent Istanbul
   instrumenter. */
if (require.main === module) {
  generate();
}

module.exports = { generate, jsFiles, DOMAINS };
