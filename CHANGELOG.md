# Changelog

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
