#!/usr/bin/env node
'use strict';

const { applyAll, checkAll, restoreAll, BACKUP_SUFFIX } = require('../lib/patch.cjs');
const { findTargets } = require('../lib/bundle-locate.cjs');

const USAGE = `pi-persian-rtl-bundle <command>

Commands:
  apply      Patch the files Pi actually runs (idempotent)
  check      Report whether the LIVE runtime path is patched
  restore    Undo the patch (in place; --force falls back to the backup)
  doctor     Show every discovered target and how it was found

Options:
  --json             Machine-readable output
  --force            restore: fall back to ${BACKUP_SUFFIX} if needed
  --bundle-dir PATH  Override the bundle chunk directory
  --tui-dist PATH    Override the legacy pi-tui dist directory

Environment:
  PI_PERSIAN_RTL_MODE   native (default) | visual | off
  PI_PERSIAN_RTL_ALIGN  right (default) | left
  PI_PERSIAN_RTL_CARET  on (default) | off
  PI_RTL_BUNDLE_DIR     Override the bundle chunk directory
  PI_TUI_DIST           Override the legacy pi-tui dist directory
`;

function parseArgs(argv) {
  const options = { command: undefined, json: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--bundle-dir') {
      process.env.PI_RTL_BUNDLE_DIR = argv[++i];
    }
    else if (arg === '--tui-dist') {
      process.env.PI_TUI_DIST = argv[++i];
    }
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else if (!options.command) options.command = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printApply(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.errors.length > 0) {
    for (const error of result.errors)
      console.error(`[pi-persian-rtl-bundle] FAILED ${error.file ?? error.dir}: ${error.error}`);
  }
  if (result.results.length === 0) {
    console.error('[pi-persian-rtl-bundle] No patch target found.');
    console.error('[pi-persian-rtl-bundle] Set PI_RTL_BUNDLE_DIR or run this with the same Node environment as pi.');
    return;
  }
  let changed = 0;
  let already = 0;
  for (const entry of result.results) {
    if (entry.error) continue;
    if (entry.changed) {
      changed++;
      console.log(`[pi-persian-rtl-bundle] patched ${entry.file ?? entry.dir}`);
    }
    else {
      already++;
      console.log(`[pi-persian-rtl-bundle] already patched ${entry.file ?? entry.dir}`);
    }
  }
  if (changed > 0)
    console.log('[pi-persian-rtl-bundle] Restart pi for the patch to take effect.');
  else if (already > 0)
    console.log('[pi-persian-rtl-bundle] Nothing to do.');
}

function printCheck(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const live = result.live;
  if (live.length === 0) {
    console.error('[pi-persian-rtl-bundle] No runtime target found.');
    process.exitCode = 1;
    return;
  }
  for (const entry of live) {
    const where = entry.kind === 'bundle' ? 'runtime bundle' : 'legacy pi-tui dist';
    console.log(`[pi-persian-rtl-bundle] ${where}: ${entry.file}`);
    console.log(`[pi-persian-rtl-bundle]   patched: ${entry.patched ? 'yes' : 'no'}`);
    if (entry.kind === 'bundle') {
      console.log(`[pi-persian-rtl-bundle]   helpers injected: ${entry.helpersInjected ? 'yes' : 'no'}`);
      console.log(`[pi-persian-rtl-bundle]   call site patched: ${entry.callSitePatched ? 'yes' : 'no'}`);
      console.log(`[pi-persian-rtl-bundle]   caret patched: ${entry.caretPatched ? 'yes' : 'no'}`);
    }
  }
  if (!result.livePatched) {
    console.error('[pi-persian-rtl-bundle] The live runtime path is NOT patched.');
    process.exitCode = 1;
  }
}

function printDoctor(json) {
  const targets = findTargets();
  if (json) {
    console.log(JSON.stringify(targets, null, 2));
    return;
  }
  console.log('[pi-persian-rtl-bundle] pi package roots:');
  for (const root of targets.piPackageRoots) console.log(`  ${root}`);
  console.log('[pi-persian-rtl-bundle] runtime bundle targets (this is what Pi executes):');
  if (targets.bundle.length === 0) console.log('  (none found)');
  for (const target of targets.bundle) console.log(`  ${target.file}`);
  console.log('[pi-persian-rtl-bundle] legacy pi-tui dist targets (Pi < 1.0 only):');
  if (targets.legacy.length === 0) console.log('  (none found)');
  for (const target of targets.legacy) console.log(`  ${target.file}`);
  console.log(`[pi-persian-rtl-bundle] live path: ${targets.live.length > 0 ? 'bundle/legacy found' : 'NOT FOUND'}`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[pi-persian-rtl-bundle] ${error.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  switch (options.command) {
    case 'apply': {
      const result = applyAll();
      printApply(result, options.json);
      if (result.errors.length > 0 || result.results.length === 0) process.exitCode = 1;
      return;
    }
    case 'check': {
      printCheck(checkAll(), options.json);
      return;
    }
    case 'restore': {
      const result = restoreAll({ force: options.force });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else if (result.restored) console.log('[pi-persian-rtl-bundle] restored. Restart pi.');
      else console.log('[pi-persian-rtl-bundle] nothing to restore.');
      return;
    }
    case 'doctor': {
      printDoctor(options.json);
      return;
    }
    case 'help':
    case undefined: {
      console.log(USAGE);
      if (options.command === undefined) process.exitCode = 2;
      return;
    }
    default: {
      console.error(`[pi-persian-rtl-bundle] unknown command: ${options.command}`);
      console.error(USAGE);
      process.exitCode = 2;
    }
  }
}

main();
