# Changelog

## 1.0.1

- **Fix package-root resolution when a package's `exports` map blocks
  `./package.json`.** Pi 1.0 declares such a map, so
  `require.resolve('@earendil-works/pi-coding-agent/package.json')` always threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. `piPackageRoots()` depended on that call, so
  its primary discovery path never worked for Pi 1.0 and only the ancestor-walk
  fallback was finding the install. `resolvePackageRoot()` now resolves the
  package entry point and walks up to the directory whose `package.json`
  declares the name. The require is injectable, so the walk-up is unit-tested
  against a synthetic package tree.
- CI: pin the Pi version per Node version and assert the expected runtime
  layout. Pi 1.0.0 requires `node >= 22.19.0`, so on Node 20 npm installs
  0.99.2, which has no bundle at all.
- CI: exercise the pre-1.0 legacy patch path against a real Pi 0.99.2 install,
  by falling back to a pristine live install when upstream's `.bak` files are
  absent.
- Test count 20 -> 22.

## 1.0.0

Initial release.

- Patch Pi 1.0's **runtime bundle** (`dist/bundle/chunks/*.js`) instead of the
  unused `node_modules/@earendil-works/pi-tui/dist` copy.
- Minified-tolerant patching: helpers are appended at module scope and the
  exact minified call site is swapped, so no comment markers are required.
- `check` reports the state of the **live** runtime path, and keeps recognising
  a chunk after it has been patched.
- Caret correction for right-aligned RTL lines
  (`pad + (total - logical)`), because `extractCursorPosition()` runs before
  `applyLineResets()`.
- Discovers the npm global prefix on Windows (`%APPDATA%\npm\node_modules`),
  plus macOS/Linux, nvm, fnm, pnpm, bun and Homebrew locations.
- Idempotent `apply`, in-place `restore`, and `doctor`.
- Best-effort support for the pre-1.0 unbundled layout, used only when no
  runtime bundle exists.
- 20 tests, including a probe that imports the real patched bundle chunk.
