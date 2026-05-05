#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// __dirname = repo/tools/build/. Walk up twice to reach the repo root.
const REPO_DIR = path.join(__dirname, '..', '..');
const APP_DIR = path.join(REPO_DIR, 'app');
const DIST_DIR = path.join(REPO_DIR, 'dist');
const STAGING = path.join(DIST_DIR, 'staging');

// Node built-ins + Max-provided modules — must NOT be bundled
const EXTERNAL = [
  'max-api',
  'http',
  'https',
  'net',
  'tls',
  'fs',
  'path',
  'os',
  'child_process',
  'crypto',
  'stream',
  'buffer',
  'util',
  'events',
  'url',
  'zlib',
  'string_decoder',
  'querystring',
  'assert',
  'punycode',
  'dns',
];

const { concat: concatLomRouter } = require('./concat-lom');
const { compile: compileCompanionPyc } = require('./compile-companion-pyc');

/**
 * Build the device for distribution: regenerate `app/lom_router.js` from
 * its sources, bundle `app/index.js` + `app/server/` via esbuild, and copy
 * the resulting files into `dist/staging/` next to a fresh `agent4live.amxd`.
 * Final freeze step is manual (Max for Live "Freeze Device" button).
 */
async function main() {
  fs.mkdirSync(STAGING, { recursive: true });

  // 0a. Regenerate app/lom_router.js from app/lom_router/*.js. The Max [js]
  //     object loads a single file, so the per-domain source files are
  //     concatenated alphabetically (00_, 10_, ...) into the monolithic output.
  concatLomRouter();

  // 0b. Compile the Python companion to .pyc with python3.11 so esbuild can
  //     embed it as raw bytes via the binary loader. End users never see
  //     python — only the dev box needs python3.11 at build time.
  compileCompanionPyc();

  // 1. Bundle app/index.js (the trampoline, which requires ./server/*) + SDK
  //    into one CJS file. esbuild follows the require chain so the whole
  //    app/server/ tree gets inlined.
  const esbuild = require(path.join(REPO_DIR, 'node_modules', 'esbuild'));
  const result = await esbuild.build({
    entryPoints: [path.join(APP_DIR, 'index.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: EXTERNAL,
    // server/ui/state.js does `require('./active.html')` — text loader turns
    // the file content into a string literal in the bundle, so the HTML is
    // embedded and Freeze Device only has to embed index.js itself.
    // Same trick for the Python companion : the .py source ships as text
    // (traceability + version diffability) and the .pyc as binary (Live 12
    // doesn't load .py source, only .pyc — see compile-companion-pyc.js).
    loader: { '.html': 'text', '.py': 'text', '.pyc': 'binary', '.md': 'text' },
    write: false,
    logLevel: 'warning',
  });
  const bundledJs = result.outputFiles[0].text;
  console.log(`index.js bundled → ${(bundledJs.length / 1024).toFixed(1)} KB`);

  // 2. Read the regenerated lom_router.js (no deps, copy as-is — runs in
  //    Max [js] SpiderMonkey, kept flat next to the .amxd because [js]
  //    cannot resolve subfolder paths via its search path mechanism).
  const lomRouterJs = fs.readFileSync(path.join(APP_DIR, 'lom_router.js'), 'utf8');

  // 3. Write staging files. node.script and [js] both find them flat next
  //    to the .amxd via Max's search path.
  fs.copyFileSync(path.join(APP_DIR, 'agent4live.amxd'), path.join(STAGING, 'agent4live.amxd'));
  fs.writeFileSync(path.join(STAGING, 'index.js'), bundledJs);
  fs.writeFileSync(path.join(STAGING, 'lom_router.js'), lomRouterJs);

  console.log('');
  console.log('Staging ready: ' + STAGING);
  console.log('  - agent4live.amxd (copy of source)');
  console.log(`  - index.js (bundle, ${(bundledJs.length / 1024).toFixed(1)} KB)`);
  console.log(`  - lom_router.js (${(lomRouterJs.length / 1024).toFixed(1)} KB)`);
  console.log('');
  console.log('Next steps to produce dist/agent4live.amxd:');
  console.log('  1. Open dist/staging/agent4live.amxd in Max (Edit button in Ableton)');
  console.log('  2. Click "Freeze Device" in the Max for Live toolbar');
  console.log('  3. File → Save As → dist/agent4live.amxd');
  console.log('  4. Distribute dist/agent4live.amxd as a single self-contained file.');
}

/* istanbul ignore if -- CLI entry guard, exercised end-to-end via `npm run
   build`. Sub-process coverage isn't propagated back to the parent Istanbul
   instrumenter. */
if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
