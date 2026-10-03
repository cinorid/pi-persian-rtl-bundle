'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const {
  patchBundleSource,
  unpatchBundleSource,
  legacyHelperBlock,
} = require('../lib/patch.cjs');
const { findTargets, isTuiChunk, BUNDLE_IDENTITY_ANCHORS } = require('../lib/bundle-locate.cjs');
const { PERSIAN_BIDI_PATCH_START } = require('../lib/bidi-source.cjs');

const targets = findTargets();
const bundleFile = targets.bundle[0]?.file;

function readBundle() {
  return fs.readFileSync(bundleFile, 'utf8');
}

/**
 * Always return the UNPATCHED source, whether or not the live bundle is
 * currently patched. Tests must not depend on the machine's patch state.
 */
function readPristine() {
  return unpatchBundleSource(readBundle());
}

test('locator finds the live runtime bundle, not just node_modules', { skip: !bundleFile && 'no runtime bundle on this machine' }, () => {
  assert.ok(bundleFile, 'expected a runtime bundle target');
  const source = readBundle();
  for (const anchor of BUNDLE_IDENTITY_ANCHORS)
    assert.ok(source.includes(anchor), `missing anchor: ${anchor}`);
  assert.ok(isTuiChunk(source));
});

test('locator still recognises the chunk AFTER patching', { skip: !bundleFile && 'no runtime bundle on this machine' }, () => {
  // Regression: an earlier version keyed chunk identity on the pristine call
  // site, so a patched bundle became invisible and `check` reported a false
  // negative on the live runtime path.
  const patched = patchBundleSource(readPristine());
  assert.ok(isTuiChunk(patched), 'patched chunk must still be discoverable');
});

test('patch is idempotent and reversible byte-for-byte', { skip: !bundleFile && 'no runtime bundle on this machine' }, () => {
  const original = readPristine();
  const patched = patchBundleSource(original);

  assert.ok(patched !== original, 'patch must change the source');
  assert.ok(patched.includes(PERSIAN_BIDI_PATCH_START));
  assert.ok(patched.includes('applyBidiTerminalOutput(line,this.terminal.columns)'));
  assert.ok(patched.includes('piFaCaretColumn(beforeMarker,'));

  // Re-applying must be a no-op.
  assert.equal(patchBundleSource(patched), patched);

  // Reversing must return the exact original bytes.
  assert.equal(unpatchBundleSource(patched), original);
});

test('patch refuses to guess when an anchor is missing', () => {
  assert.throws(() => patchBundleSource('const x = 1;'), /anchor/i);
});

test('patched bundle is still valid ESM', { skip: !bundleFile && 'no runtime bundle on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rtl-esm-'));
  const file = path.join(dir, 'chunk.mjs');
  try {
    fs.writeFileSync(file, patchBundleSource(readPristine()), 'utf8');
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('injected helpers work inside the real bundle module', { skip: !bundleFile && 'no runtime bundle on this machine' }, async () => {
  const dir = path.dirname(bundleFile);
  const probe = path.join(dir, `.pi-rtl-probe-${process.pid}-${Date.now()}.mjs`);
  const RLI = '\u2067';
  const PDI = '\u2069';
  try {
    // The probe must live beside the real chunks so relative imports resolve.
    const patched = patchBundleSource(readPristine());
    fs.writeFileSync(probe, `${patched}\nexport { applyBidiTerminalOutput, piFaCaretColumn };\n`, 'utf8');

    const mod = await import(pathToFileURL(probe).href);
    assert.equal(typeof mod.applyBidiTerminalOutput, 'function');
    assert.equal(typeof mod.piFaCaretColumn, 'function');

    const out = mod.applyBidiTerminalOutput('سلام دنیا', 40);
    assert.equal(out, ' '.repeat(31) + RLI + 'سلام دنیا' + PDI);

    // LTR-first lines must pass through untouched.
    assert.equal(mod.applyBidiTerminalOutput('hello سلام', 40), 'hello سلام');

    // Caret math uses the bundle's own visibleWidth.
    assert.equal(mod.piFaCaretColumn('', 'سلام', 40), 40);
    assert.equal(mod.piFaCaretColumn('سلام', 'سلام', 40), 36);
  }
  finally {
    fs.rmSync(probe, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Legacy layout (Pi < 1.0) — round-tripped against a real legacy install
// ---------------------------------------------------------------------------

const legacyTarget = targets.legacy[0]?.file;

/**
 * Find a PRISTINE copy of a legacy file to use as a fixture.
 *
 * Prefers a backup left by a previous patch; otherwise falls back to the live
 * file, but only when nothing has patched it yet (a patched file is not a
 * valid "before" fixture).
 */
function pristineLegacyFile(dir, name) {
  const live = path.join(dir, name);
  for (const suffix of ['.pi-persian-rtl.bak', '.pi-persian-rtl-bundle.bak']) {
    const backup = live + suffix;
    if (fs.existsSync(backup)) return backup;
  }
  if (!fs.existsSync(live)) return undefined;
  const source = fs.readFileSync(live, 'utf8');
  if (source.includes('PI_PERSIAN_RTL_PATCH_START') || source.includes('PI_PERSIAN_RTL_BUNDLE_PATCH_START'))
    return undefined;
  return live;
}

const legacyUtilsFixture = legacyTarget ? pristineLegacyFile(legacyTarget, 'utils.js') : undefined;
const legacyTuiFixture = legacyTarget ? pristineLegacyFile(legacyTarget, 'tui.js') : undefined;
const haveLegacyFixtures = Boolean(legacyUtilsFixture && legacyTuiFixture);

test('legacy helper block exports what the legacy import needs', () => {
  const block = legacyHelperBlock();
  assert.ok(block.includes('export function applyBidiTerminalOutput('));
  assert.ok(block.includes('export function piFaCaretColumn('));
});

test('legacy patch applies and reverts against a real legacy install', { skip: !haveLegacyFixtures && 'no pristine legacy fixtures on this machine' }, () => {
  const { patchLegacyDir, restoreLegacyDir } = require('../lib/patch.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rtl-legacy-'));
  const utils = path.join(dir, 'utils.js');
  const tui = path.join(dir, 'tui.js');
  const pristineUtils = fs.readFileSync(legacyUtilsFixture, 'utf8');
  const pristineTui = fs.readFileSync(legacyTuiFixture, 'utf8');
  try {
    fs.writeFileSync(utils, pristineUtils, 'utf8');
    fs.writeFileSync(tui, pristineTui, 'utf8');

    const applied = patchLegacyDir(dir);
    assert.ok(applied.changed);

    const patchedUtils = fs.readFileSync(utils, 'utf8');
    const patchedTui = fs.readFileSync(tui, 'utf8');
    assert.ok(patchedUtils.includes(PERSIAN_BIDI_PATCH_START));
    assert.ok(patchedUtils.includes('export function applyBidiTerminalOutput('));
    assert.ok(patchedTui.includes('import { applyBidiTerminalOutput,'));
    assert.ok(patchedTui.includes('applyBidiTerminalOutput(line, this.terminal.columns)'));
    assert.ok(patchedTui.includes('piFaCaretColumn(beforeMarker, lines[row], this.terminal.columns)'));

    execFileSync(process.execPath, ['--check', utils], { stdio: 'pipe' });
    execFileSync(process.execPath, ['--check', tui], { stdio: 'pipe' });

    // Idempotent.
    const reapplied = patchLegacyDir(dir);
    assert.equal(reapplied.changed, false);

    const reverted = restoreLegacyDir(dir);
    assert.ok(reverted.restored);
    assert.equal(fs.readFileSync(utils, 'utf8'), pristineUtils);
    assert.equal(fs.readFileSync(tui, 'utf8'), pristineTui);
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
