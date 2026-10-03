# Upstream report — draft only

**Status: NOT FILED.** Per instruction, this is a draft. Nothing was posted.

Target: <https://github.com/earendil-works/pi/issues/new?template=bug.yml>

Why not the pi.dev "report" link: `package-report.yml` only accepts *Malicious
or unsafe behavior*, *Impersonation*, or *Trademark / TOS Violations*. A
functional bug does not fit it, and that template explicitly redirects core
bugs to `bug.yml`.

`pi-persian-rtl` publishes no `repository` field on npm (homepage is only
`https://pi.dev/packages`), and its author's GitHub account has no repo for it,
so there is no package-issue tracker to file against.

---

## Title

```
TUI-layer patch extensions are silently inert: 1.0 bundles pi-tui into dist/bundle
```

## What happened?

Pi 1.0.0's npm bin runs a self-contained Bun bundle:

```
pi.cmd -> <pkg>/dist/bundle/cli.js
       -> dist/bundle/cli-runtime.js
       -> dist/bundle/chunks/*.js
```

All of `@earendil-works/pi-tui` is inlined into
`dist/bundle/chunks/chunk-2KTBZM5G.js` — it exports `TuiMainScreen`, `Editor`,
`Markdown`, `visibleWidth`, `TUI_KEYBINDINGS`, and so on — and there is **no
external import of `@earendil-works/pi-tui` anywhere under `dist/bundle/`**.

The consequence is that extensions which patch the TUI output layer by editing
`node_modules/@earendil-works/pi-tui/dist/{utils.js,tui.js}` apply cleanly, and
then do nothing. `npm:pi-persian-rtl@0.1.1` is a concrete case: it reports
`patched: ...`, its backup files are created, its helper block is really present
in `node_modules/.../pi-tui/dist/utils.js` — and Pi renders exactly as before,
because the running TUI comes from the bundle.

This is hard to self-diagnose, because:

* the package's own `check` command inspects the file it patched, not the file
  Pi runs, so it reports success;
* the patched file is a genuine, current copy of pi-tui, so nothing looks stale;
* there is no warning that a bundled runtime makes the patch a no-op.

## Steps to reproduce

```sh
npm install -g @earendil-works/pi-coding-agent   # 1.0.0
pi install npm:pi-persian-rtl
npx pi-persian-rtl apply
npx pi-persian-rtl check        # -> "patched: <path>"
```

Now compare the two copies:

```sh
PI=~/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent   # or %APPDATA%\npm\node_modules\...
CHUNK=$(grep -rl "applyLineResets(lines){" "$PI/dist/bundle/chunks/")

# the file the extension patched
grep -c applyBidiTerminalOutput "$PI/node_modules/@earendil-works/pi-tui/dist/tui.js"
# -> 2   (patched)

# the file Pi actually executes
grep -c applyBidiTerminalOutput "$CHUNK"
# -> 0   (never patched)

# and nothing in the bundle pulls pi-tui from node_modules
grep -rho 'from"@earendil-works/pi-tui[^"]*"' "$PI/dist/bundle/" | sort -u
# -> (empty)
```

## Expected behavior

Pick whichever you prefer — any one of these would have saved hours:

* Pi documents that 1.0's runtime is a self-contained bundle, so patching
  `node_modules/@earendil-works/pi-tui/dist` no longer affects rendering; and/or
* Pi emits a startup warning when an installed package patches a pi-tui copy
  that the running process does not load; and/or
* the runtime exposes a supported hook for output-layer transforms, so packages
  like this do not have to patch files at all.

## Version

`1.0.0` (npm global install, Windows 11, Node v24.19.0)

---

## Suggested fix for the package author

Two independent blockers, both needed:

1. **Patch the right file.** Target the bundled chunk. Identify it by anchors
   that survive patching (`applyLineResets(lines){` +
   `extractCursorPosition(lines,height){`), *not* by the pristine call site —
   otherwise a patched bundle stops being discoverable and `check` reports a
   false negative.

2. **Match minified code.** Comment-marker strategies cannot work: the bundle
   has no comments, so the existing `/** Extract ANSI escape sequences … */`
   insertion marker is absent, and the existing output regex requires a trailing
   `;` that minified output does not have. Append helpers at module scope
   instead (function declarations hoist), and swap the exact minified call site.

Also worth fixing in the same pass:

3. **Caret offset.** `extractCursorPosition()` runs *before*
   `applyLineResets()`, so right-align padding shifts text out from under the
   caret. Correct the column as `pad + (total - logical)` for RTL-first lines.

4. **Windows discovery.** `candidateDistDirs()` never searches the npm global
   prefix (`%APPDATA%\npm\node_modules`), so `npx pi-persian-rtl check/apply`
   fails with *"Could not locate @earendil-works/pi-tui/dist"* on a default
   Windows install unless `PI_TUI_DIST` is set.

A working reference implementation of all four points, with tests that load the
real patched chunk, is in this directory.
