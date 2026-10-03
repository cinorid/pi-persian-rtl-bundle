# Changelog

## 1.1.0

Two bugs that made Persian still render wrong in a real terminal, both found by
screenshotting the live TUI in Windows Terminal.

- **Right-alignment never happened.** Pi's layout frame
  (`renderLayoutFrame` -> `paintBox`) pads every line out to the terminal width
  *before* `applyLineResets()` runs, so `columns - visibleWidth(line)` was
  always `0`. Trailing padding is now relocated to the front instead of added,
  and a bare line and a frame-padded line produce identical output.
- **Mode default was wrong for most terminals.** Windows Terminal does not
  implement the Unicode Bidirectional Algorithm (microsoft/terminal#538, open
  since 2019) and neither does conhost, so `native` mode's RLI/PDI were inert
  and Persian stayed reversed. The mode is now auto-detected: Windows Terminal
  / win32 -> `visual`, elsewhere -> `native`. Explicit
  `PI_PERSIAN_RTL_MODE` still wins; `PI_PERSIAN_RTL_TERMINAL_BIDI=true|false`
  overrides just the probe.
- **Visual mode no longer discards colour.** It reorders graphemes while
  carrying the ANSI state with each one, so a BiDi-less terminal keeps syntax
  highlighting instead of losing all styling.
- **Upgrade fix:** the patch start marker is now matched by its
  version-independent prefix. Bumping the version previously made an older
  patch block unrecognisable, so re-applying left two copies of the helpers and
  the bundle failed to load with "Identifier already declared".
- Test count 22 -> 34.

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
