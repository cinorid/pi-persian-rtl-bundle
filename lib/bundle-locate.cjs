'use strict';

/**
 * Locate the files that Pi ACTUALLY executes at runtime.
 *
 * Pi 1.0+ ships a self-contained Bun bundle:
 *
 *   bin:  <pkg>/dist/bundle/cli.js
 *         -> dist/bundle/cli-runtime.js
 *         -> dist/bundle/chunks/*.js
 *
 * All of @earendil-works/pi-tui is inlined into one of those chunks, and
 * nothing in dist/bundle/ imports @earendil-works/pi-tui from node_modules.
 * Patching node_modules/@earendil-works/pi-tui/dist is therefore a no-op.
 *
 * Older Pi releases ran the unbundled `dist/**` tree and did import
 * @earendil-works/pi-tui, so that layout is still supported as a secondary
 * target.
 */

const fs = require('node:fs');
const os = require('node:os');
const { createRequire } = require('node:module');
const { dirname, join, resolve } = require('node:path');

const nodeRequire = createRequire(__filename);

const PI_PACKAGE = '@earendil-works/pi-coding-agent';
const LEGACY_TUI_PACKAGE = '@earendil-works/pi-tui';

const BUNDLE_DIR_SEGMENTS = ['dist', 'bundle', 'chunks'];

/**
 * Anchors that identify a bundled chunk as the TUI module.
 *
 * The call-site anchor must accept BOTH the pristine and the patched form,
 * otherwise a patched bundle stops being discoverable and `check` reports a
 * false negative on the live runtime path.
 */
const BUNDLE_IDENTITY_ANCHORS = [
  'applyLineResets(lines){',
  'extractCursorPosition(lines,height){',
];

const BUNDLE_CALL_ANCHOR_ORIGINAL = 'isImageLine(line)||(lines[i]=normalizeTerminalOutput(line)+reset)';
const BUNDLE_CALL_ANCHOR_PATCHED = 'isImageLine(line)||(lines[i]=applyBidiTerminalOutput(line,this.terminal.columns)+reset)';

const BUNDLE_CALL_ANCHORS = [BUNDLE_CALL_ANCHOR_ORIGINAL, BUNDLE_CALL_ANCHOR_PATCHED];

/** Kept for callers that want the full anchor vocabulary. */
const BUNDLE_REQUIRED_ANCHORS = [...BUNDLE_IDENTITY_ANCHORS, ...BUNDLE_CALL_ANCHORS];

function isTuiChunk(source) {
  return BUNDLE_IDENTITY_ANCHORS.every((anchor) => source.includes(anchor))
    && BUNDLE_CALL_ANCHORS.some((anchor) => source.includes(anchor));
}

function unique(items) {
  return [...new Set(items.filter(Boolean).map((item) => resolve(item)))];
}

function ancestors(start, limit = 10) {
  const result = [];
  let current = resolve(start);
  for (let i = 0; i < limit; i++) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function safeResolve(id, requireFn = nodeRequire) {
  try {
    return requireFn.resolve(id);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a package's root directory.
 *
 * `require.resolve('<pkg>/package.json')` is NOT reliable: a package with an
 * `exports` map (Pi 1.0 has one) blocks that subpath with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Fall back to resolving the package entry
 * point and walking up to the directory whose package.json declares the name.
 *
 * `requireFn` is injectable so the walk-up can be unit-tested against a
 * synthetic package tree.
 */
function resolvePackageRoot(name, requireFn = nodeRequire) {
  const direct = safeResolve(`${name}/package.json`, requireFn);
  if (direct) return dirname(direct);

  const entry = safeResolve(name, requireFn);
  if (!entry) return undefined;

  let current = dirname(entry);
  for (let i = 0; i < 12; i++) {
    const candidate = join(current, 'package.json');
    if (isFile(candidate)) {
      try {
        if (JSON.parse(fs.readFileSync(candidate, 'utf8')).name === name) return current;
      } catch {
        // unreadable or invalid package.json; keep walking up
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function packageSegments(name) {
  return name.split('/');
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Global node_modules roots.
 *
 * This is the case upstream pi-persian-rtl misses entirely, which makes its
 * CLI fail on a default Windows npm install.
 */
function globalNodeModuleRoots() {
  const home = os.homedir();
  const env = process.env;
  const roots = [];

  if (env.APPDATA) roots.push(join(env.APPDATA, 'npm', 'node_modules'));
  if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'npm', 'node_modules'));

  roots.push(
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
  );

  roots.push(
    join(home, '.npm-global', 'lib', 'node_modules'),
    join(home, 'n', 'lib', 'node_modules'),
    join(home, '.bun', 'install', 'global', 'node_modules'),
    join(home, 'Library', 'pnpm', 'global', '5', 'node_modules'),
    join(home, '.local', 'share', 'pnpm', 'global', '5', 'node_modules'),
  );

  for (const prefix of [env.npm_config_prefix, env.PREFIX, env.NPM_CONFIG_PREFIX]) {
    if (!prefix) continue;
    roots.push(join(prefix, 'lib', 'node_modules'), join(prefix, 'node_modules'));
  }

  // nvm: ~/.nvm/versions/node/<version>/lib/node_modules
  const nvmRoot = join(home, '.nvm', 'versions', 'node');
  try {
    for (const version of fs.readdirSync(nvmRoot))
      roots.push(join(nvmRoot, version, 'lib', 'node_modules'));
  } catch {
    // not using nvm
  }

  // fnm: ~/.local/share/fnm/node-versions/<version>/installation/lib/node_modules
  const fnmRoot = join(home, '.local', 'share', 'fnm', 'node-versions');
  try {
    for (const version of fs.readdirSync(fnmRoot))
      roots.push(join(fnmRoot, version, 'installation', 'lib', 'node_modules'));
  } catch {
    // not using fnm
  }

  return unique(roots.filter((root) => isDirectory(root)));
}

/** Directories that may contain node_modules, derived from the environment. */
function searchRoots() {
  const roots = [
    ...ancestors(process.cwd()),
    ...ancestors(dirname(process.execPath)),
    ...ancestors(os.homedir()),
  ];
  if (process.argv[1]) roots.push(...ancestors(dirname(process.argv[1])));
  roots.push(...globalNodeModuleRoots());
  return unique(roots);
}

/** Candidate roots of the @earendil-works/pi-coding-agent package. */
function piPackageRoots() {
  const roots = [];

  const resolved = resolvePackageRoot(PI_PACKAGE);
  if (resolved) roots.push(resolved);

  for (const root of searchRoots()) {
    roots.push(join(root, 'node_modules', ...packageSegments(PI_PACKAGE)));
    roots.push(join(root, 'lib', 'node_modules', ...packageSegments(PI_PACKAGE)));
    roots.push(join(root, ...packageSegments(PI_PACKAGE)));
  }

  return unique(roots).filter((root) => isFile(join(root, 'package.json')));
}

/** Candidate roots of the legacy @earendil-works/pi-tui package. */
function legacyTuiRoots() {
  const roots = [];

  const resolved = resolvePackageRoot(LEGACY_TUI_PACKAGE);
  if (resolved) roots.push(resolved);

  for (const root of [...piPackageRoots(), ...searchRoots()]) {
    roots.push(join(root, 'node_modules', ...packageSegments(LEGACY_TUI_PACKAGE)));
    roots.push(join(root, 'lib', 'node_modules', ...packageSegments(LEGACY_TUI_PACKAGE)));
    roots.push(join(root, ...packageSegments(LEGACY_TUI_PACKAGE)));
  }

  return unique(roots);
}

/** Find the bundled chunk(s) that contain the TUI implementation. */
function findBundleTargets() {
  const dirs = [];
  if (process.env.PI_RTL_BUNDLE_DIR)
    dirs.push(process.env.PI_RTL_BUNDLE_DIR);
  for (const root of piPackageRoots())
    dirs.push(join(root, ...BUNDLE_DIR_SEGMENTS));

  const targets = [];
  for (const dir of unique(dirs)) {
    if (!isDirectory(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.js') || entry.endsWith('.min.js')) continue;
      const file = join(dir, entry);
      if (!isFile(file)) continue;
      let source;
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (isTuiChunk(source))
        targets.push({ kind: 'bundle', file });
    }
  }
  return targets;
}

/** Find the legacy (unbundled) pi-tui dist directory, if present. */
function findLegacyTargets() {
  const dirs = [];
  if (process.env.PI_TUI_DIST) dirs.push(process.env.PI_TUI_DIST);
  for (const root of legacyTuiRoots()) dirs.push(join(root, 'dist'));

  const targets = [];
  for (const dir of unique(dirs)) {
    if (!isDirectory(dir)) continue;
    if (isFile(join(dir, 'utils.js')) && isFile(join(dir, 'tui.js')))
      targets.push({ kind: 'legacy', file: dir });
  }
  return targets;
}

/**
 * Resolve every patch target.
 *
 * `bundle` targets are the live runtime path on Pi 1.0+.
 * `legacy` targets only matter on older Pi releases.
 */
function findTargets() {
  const bundle = findBundleTargets();
  const legacy = findLegacyTargets();
  return {
    bundle,
    legacy,
    // The live path wins: if a bundle exists, that is what Pi runs.
    live: bundle.length > 0 ? bundle : legacy,
    piPackageRoots: piPackageRoots(),
  };
}

module.exports = {
  BUNDLE_CALL_ANCHORS,
  BUNDLE_IDENTITY_ANCHORS,
  BUNDLE_REQUIRED_ANCHORS,
  findBundleTargets,
  findLegacyTargets,
  findTargets,
  globalNodeModuleRoots,
  isTuiChunk,
  piPackageRoots,
  resolvePackageRoot,
  searchRoots,
};
