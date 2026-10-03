'use strict';

/**
 * Deterministic, idempotent patcher for Pi's runtime bundle.
 *
 * Every mutation is expressed as an exact string swap with a matching exact
 * reverse swap, so `apply` is idempotent and `restore` never needs to guess.
 * If an anchor is missing or ambiguous we refuse to write anything.
 */

const fs = require('node:fs');
const { dirname, join } = require('node:path');

const {
  PERSIAN_BIDI_HELPERS,
  PERSIAN_BIDI_PATCH_START_PREFIX,
  PERSIAN_BIDI_PATCH_END,
} = require('./bidi-source.cjs');
const { findTargets } = require('./bundle-locate.cjs');

const BACKUP_SUFFIX = '.pi-persian-rtl-bundle.bak';

/** Upstream pi-persian-rtl markers, stripped when we take over the legacy path. */
const FOREIGN_PATCH_START = '// PI_PERSIAN_RTL_PATCH_START';
const FOREIGN_PATCH_END = '// PI_PERSIAN_RTL_PATCH_END';

// ---------------------------------------------------------------------------
// Bundle anchors
// ---------------------------------------------------------------------------

const BUNDLE_CALL_ORIGINAL = 'isImageLine(line)||(lines[i]=normalizeTerminalOutput(line)+reset)';
const BUNDLE_CALL_PATCHED = 'isImageLine(line)||(lines[i]=applyBidiTerminalOutput(line,this.terminal.columns)+reset)';

const BUNDLE_CURSOR_ORIGINAL = 'CURSOR_MARKER.length),{row,col}';
const BUNDLE_CURSOR_PATCHED = 'CURSOR_MARKER.length),{row,col:piFaCaretColumn(beforeMarker,line.slice(0,markerIndex)+line.slice(markerIndex+CURSOR_MARKER.length),this.terminal.columns)}';

// applySelection() renders the highlight on the LOGICAL line, before
// applyLineResets() reorders it, so the highlight must be mirrored for RTL
// lines. The copy path (getActiveSelectionText) reads previousScreen, which
// already holds the reordered lines, and must NOT be mirrored - hence only
// this one call site is patched.
const BUNDLE_SELECTION_ORIGINAL = 'this.getSelectionColumns(line,row,screenSelection,minColumn,maxColumn)';
const BUNDLE_SELECTION_PATCHED = 'this.getSelectionColumns(line,row,piFaMirrorSelection(line,screenSelection),minColumn,maxColumn)';

// ---------------------------------------------------------------------------
// Legacy (unbundled, Pi < 1.0) anchors
// ---------------------------------------------------------------------------

const LEGACY_UTILS_MARKER = '/**\n * Extract ANSI escape sequences from a string at the given position.\n */';

const LEGACY_IMPORT_ORIGINAL = 'import { extractSegments, normalizeTerminalOutput, sliceByColumn, sliceWithWidth, visibleWidth } from "./utils.js";';
const LEGACY_IMPORT_PATCHED = 'import { applyBidiTerminalOutput, extractSegments, normalizeTerminalOutput, piFaCaretColumn, sliceByColumn, sliceWithWidth, visibleWidth } from "./utils.js";';

const LEGACY_CALL_ORIGINAL = 'lines[i] = normalizeTerminalOutput(line) + reset;';
const LEGACY_CALL_PATCHED = 'lines[i] = applyBidiTerminalOutput(line, this.terminal.columns) + reset;';

const LEGACY_CURSOR_ORIGINAL = 'return { row, col };';
const LEGACY_CURSOR_PATCHED = 'return { row, col: piFaCaretColumn(beforeMarker, lines[row], this.terminal.columns) };';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOccurrences(source, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count++;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function replaceExactlyOnce(source, needle, replacement, label) {
  const count = countOccurrences(source, needle);
  if (count !== 1)
    throw new Error(`${label}: expected exactly 1 anchor, found ${count}`);
  return source.replace(needle, replacement);
}

function replaceIfPresent(source, needle, replacement) {
  const count = countOccurrences(source, needle);
  if (count === 0) return source;
  if (count > 1)
    throw new Error(`reverse anchor is ambiguous (${count} matches)`);
  return source.replace(needle, replacement);
}

/** Remove a marker-delimited block, including its trailing newline. */
function stripMarkedBlock(source, startMarker, endMarker) {
  let next = source;
  for (;;) {
    const start = next.indexOf(startMarker);
    if (start === -1) return next;
    const end = next.indexOf(endMarker, start);
    if (end === -1)
      throw new Error(`unterminated patch block (${startMarker} without ${endMarker})`);
    let after = end + endMarker.length;
    if (next.startsWith('\r\n', after)) after += 2;
    else if (next.startsWith('\n', after)) after += 1;
    next = next.slice(0, start) + next.slice(after);
  }
}

function hasOurMarkers(source) {
  return source.includes(PERSIAN_BIDI_PATCH_START_PREFIX);
}

function backupFile(file) {
  const backup = file + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  return backup;
}

function writeAtomic(file, source) {
  const temporary = `${file}.pi-rtl-bundle.tmp-${process.pid}`;
  fs.writeFileSync(temporary, source, 'utf8');
  fs.renameSync(temporary, file);
}

// ---------------------------------------------------------------------------
// Bundle patching
// ---------------------------------------------------------------------------

/** Exportable variant of the helper block, for the ESM legacy layout. */
function legacyHelperBlock() {
  return PERSIAN_BIDI_HELPERS
    .replace('function applyBidiTerminalOutput(', 'export function applyBidiTerminalOutput(')
    .replace('function piFaCaretColumn(', 'export function piFaCaretColumn(');
}

function patchBundleSource(source) {
  // Always start from a clean, unpatched base so re-applying is a no-op.
  const base = unpatchBundleSource(source);

  let next = replaceExactlyOnce(base, BUNDLE_CALL_ORIGINAL, BUNDLE_CALL_PATCHED, 'applyLineResets call site');
  next = replaceExactlyOnce(next, BUNDLE_CURSOR_ORIGINAL, BUNDLE_CURSOR_PATCHED, 'extractCursorPosition caret');
  next = replaceExactlyOnce(next, BUNDLE_SELECTION_ORIGINAL, BUNDLE_SELECTION_PATCHED, 'applySelection column mapping');

  // Append at module scope, never inside the class body.
  // Function declarations hoist, so the helpers are reachable from the class
  // methods; the const initializers run at the end of module evaluation, which
  // is always before any render call.
  const separator = next.endsWith('\n') ? '' : '\n';
  return next + separator + PERSIAN_BIDI_HELPERS + '\n';
}

function unpatchBundleSource(source) {
  let next = stripMarkedBlock(source, PERSIAN_BIDI_PATCH_START_PREFIX, PERSIAN_BIDI_PATCH_END);
  next = replaceIfPresent(next, BUNDLE_CALL_PATCHED, BUNDLE_CALL_ORIGINAL);
  next = replaceIfPresent(next, BUNDLE_CURSOR_PATCHED, BUNDLE_CURSOR_ORIGINAL);
  next = replaceIfPresent(next, BUNDLE_SELECTION_PATCHED, BUNDLE_SELECTION_ORIGINAL);
  return next;
}

function patchBundleFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  const patched = patchBundleSource(original);
  if (patched === original)
    return { file, kind: 'bundle', changed: false, alreadyPatched: true };
  backupFile(file);
  writeAtomic(file, patched);
  return { file, kind: 'bundle', changed: true, alreadyPatched: false };
}

function restoreBundleFile(file, options = {}) {
  if (!fs.existsSync(file))
    return { file, kind: 'bundle', restored: false, reason: 'missing' };
  const original = fs.readFileSync(file, 'utf8');
  const restored = unpatchBundleSource(original);
  if (restored !== original) {
    writeAtomic(file, restored);
    return { file, kind: 'bundle', restored: true, method: 'in-place' };
  }
  const backup = file + BACKUP_SUFFIX;
  if (options.force && fs.existsSync(backup)) {
    fs.copyFileSync(backup, file);
    return { file, kind: 'bundle', restored: true, method: 'backup' };
  }
  return { file, kind: 'bundle', restored: false, reason: 'not patched' };
}

// ---------------------------------------------------------------------------
// Legacy (unbundled) patching
// ---------------------------------------------------------------------------

function patchLegacyDir(dir) {
  const utils = join(dir, 'utils.js');
  const tui = join(dir, 'tui.js');
  const results = { dir, kind: 'legacy', changed: false, files: [] };

  for (const file of [utils, tui]) {
    if (!fs.existsSync(file))
      throw new Error(`legacy target missing ${file}`);
  }

  // utils.js: strip any foreign patch, then insert our exported helpers.
  const utilsOriginal = fs.readFileSync(utils, 'utf8');
  let utilsNext = stripMarkedBlock(utilsOriginal, FOREIGN_PATCH_START, FOREIGN_PATCH_END);
  utilsNext = stripMarkedBlock(utilsNext, PERSIAN_BIDI_PATCH_START_PREFIX, PERSIAN_BIDI_PATCH_END);
  const utilsInsertAt = utilsNext.indexOf(LEGACY_UTILS_MARKER);
  if (utilsInsertAt === -1)
    throw new Error('legacy utils.js insertion marker not found');
  utilsNext = utilsNext.slice(0, utilsInsertAt) + legacyHelperBlock() + '\n' + utilsNext.slice(utilsInsertAt);

  // tui.js: import + call site + caret.
  const tuiOriginal = fs.readFileSync(tui, 'utf8');
  let tuiNext = replaceIfPresent(tuiOriginal, LEGACY_IMPORT_PATCHED, LEGACY_IMPORT_ORIGINAL);
  tuiNext = replaceIfPresent(tuiNext, LEGACY_CALL_PATCHED, LEGACY_CALL_ORIGINAL);
  tuiNext = replaceIfPresent(tuiNext, LEGACY_CURSOR_PATCHED, LEGACY_CURSOR_ORIGINAL);
  tuiNext = replaceExactlyOnce(tuiNext, LEGACY_IMPORT_ORIGINAL, LEGACY_IMPORT_PATCHED, 'legacy tui.js import');
  tuiNext = replaceExactlyOnce(tuiNext, LEGACY_CALL_ORIGINAL, LEGACY_CALL_PATCHED, 'legacy tui.js call site');
  tuiNext = replaceExactlyOnce(tuiNext, LEGACY_CURSOR_ORIGINAL, LEGACY_CURSOR_PATCHED, 'legacy tui.js caret');

  for (const [file, before, after] of [[utils, utilsOriginal, utilsNext], [tui, tuiOriginal, tuiNext]]) {
    if (before === after) {
      results.files.push({ file, changed: false });
      continue;
    }
    backupFile(file);
    writeAtomic(file, after);
    results.changed = true;
    results.files.push({ file, changed: true });
  }

  return results;
}

function restoreLegacyDir(dir, options = {}) {
  const results = { dir, kind: 'legacy', restored: false, files: [] };
  for (const file of [join(dir, 'utils.js'), join(dir, 'tui.js')]) {
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    let next = stripMarkedBlock(original, PERSIAN_BIDI_PATCH_START_PREFIX, PERSIAN_BIDI_PATCH_END);
    next = replaceIfPresent(next, LEGACY_IMPORT_PATCHED, LEGACY_IMPORT_ORIGINAL);
    next = replaceIfPresent(next, LEGACY_CALL_PATCHED, LEGACY_CALL_ORIGINAL);
    next = replaceIfPresent(next, LEGACY_CURSOR_PATCHED, LEGACY_CURSOR_ORIGINAL);
    if (next !== original) {
      writeAtomic(file, next);
      results.restored = true;
      results.files.push({ file, restored: true });
      continue;
    }
    const backup = file + BACKUP_SUFFIX;
    if (options.force && fs.existsSync(backup)) {
      fs.copyFileSync(backup, file);
      results.restored = true;
      results.files.push({ file, restored: true, method: 'backup' });
      continue;
    }
    results.files.push({ file, restored: false });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function applyAll(options = {}) {
  const targets = findTargets();
  const results = [];

  for (const target of targets.bundle) {
    try {
      results.push(patchBundleFile(target.file));
    } catch (error) {
      results.push({ file: target.file, kind: 'bundle', changed: false, error: error.message });
    }
  }

  // Only touch the legacy layout when no runtime bundle exists; otherwise it
  // is dead weight and risks conflicting with upstream pi-persian-rtl.
  if (targets.bundle.length === 0 && options.includeLegacy !== false) {
    for (const target of targets.legacy) {
      try {
        results.push(patchLegacyDir(target.file));
      } catch (error) {
        results.push({ dir: target.file, kind: 'legacy', changed: false, error: error.message });
      }
    }
  }

  return { targets, results, patched: results.some((r) => r.changed), errors: results.filter((r) => r.error) };
}

function checkAll() {
  const targets = findTargets();
  const bundle = targets.bundle.map((target) => {
    const source = fs.readFileSync(target.file, 'utf8');
    return {
      file: target.file,
      kind: 'bundle',
      helpersInjected: source.includes(PERSIAN_BIDI_PATCH_START_PREFIX),
      callSitePatched: source.includes(BUNDLE_CALL_PATCHED),
      caretPatched: source.includes(BUNDLE_CURSOR_PATCHED),
      selectionPatched: source.includes(BUNDLE_SELECTION_PATCHED),
      patched:
        source.includes(PERSIAN_BIDI_PATCH_START_PREFIX) &&
        source.includes(BUNDLE_CALL_PATCHED) &&
        source.includes(BUNDLE_CURSOR_PATCHED) &&
        source.includes(BUNDLE_SELECTION_PATCHED),
      backup: fs.existsSync(target.file + BACKUP_SUFFIX),
    };
  });

  const legacy = targets.legacy.map((target) => {
    const utils = join(target.file, 'utils.js');
    const tui = join(target.file, 'tui.js');
    const utilsSource = fs.existsSync(utils) ? fs.readFileSync(utils, 'utf8') : '';
    const tuiSource = fs.existsSync(tui) ? fs.readFileSync(tui, 'utf8') : '';
    return {
      file: target.file,
      kind: 'legacy',
      patched: utilsSource.includes(PERSIAN_BIDI_PATCH_START_PREFIX) && tuiSource.includes(LEGACY_CALL_PATCHED),
      foreignPatch: utilsSource.includes(FOREIGN_PATCH_START),
    };
  });

  return {
    bundle,
    legacy,
    // What Pi will actually run.
    live: targets.bundle.length > 0 ? bundle : legacy,
    livePatched: targets.bundle.length > 0
      ? bundle.some((entry) => entry.patched)
      : legacy.some((entry) => entry.patched),
  };
}

function restoreAll(options = {}) {
  const targets = findTargets();
  const results = [];
  for (const target of targets.bundle)
    results.push(restoreBundleFile(target.file, options));
  for (const target of targets.legacy)
    results.push(restoreLegacyDir(target.file, options));
  return { targets, results, restored: results.some((r) => r.restored) };
}

module.exports = {
  BACKUP_SUFFIX,
  BUNDLE_SELECTION_PATCHED,
  applyAll,
  checkAll,
  findTargets,
  legacyHelperBlock,
  patchBundleFile,
  patchBundleSource,
  patchLegacyDir,
  restoreAll,
  restoreBundleFile,
  restoreLegacyDir,
  unpatchBundleSource,
};
