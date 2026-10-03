# Contributing

Thanks for looking. This package patches another program's bundle, so a few
rules matter more here than usual.

## Read this first

`pi-persian-rtl-bundle` edits Pi's own runtime bundle
(`<pi-pkg>/dist/bundle/chunks/*.js`) on the user's machine. That is inherently
unsupported and fragile:

* a Pi update replaces the chunk and the patch must be re-applied;
* the anchors this package matches are **minified source text** and can change
  in any Pi release without notice.

Any change that touches `lib/patch.cjs` or `lib/bundle-locate.cjs` needs a
matching test.

## Setup

```sh
git clone https://github.com/cinorid/pi-persian-rtl-bundle.git
cd pi-persian-rtl-bundle
npm run check
```

There are no runtime dependencies. Node 20+ is required.

## Tests

```sh
npm test
```

The integration tests read your **real installed Pi** and skip cleanly if none
is present. To run them:

```sh
npm install -g @earendil-works/pi-coding-agent
npm test
```

One test writes a temporary probe file next to the real bundle chunks (so its
relative imports resolve) and deletes it in a `finally` block. If the process is
killed mid-test, look for stray `.pi-rtl-probe-*.mjs` files there.

### Requirements for patch changes

1. **Every mutation must be reversible by an exact reverse swap.**
   `unpatch(patch(x)) === x`, byte for byte.
2. **`apply` must be idempotent.** Running it twice must not change the file the
   second time.
3. **Refuse to guess.** If an anchor is not found exactly once, throw and write
   nothing. Never do a fuzzy or partial match.
4. **Anchor on text that survives patching.** Chunk identity must not depend on
   the pristine call site, or a patched bundle becomes undiscoverable and
   `check` reports a false negative.
5. **Insert at module scope.** `applyLineResets(lines){` is a class method;
   inserting a `const` there is a syntax error. Append at end of file and rely
   on function hoisting.

## Testing against a new Pi version

```sh
npm install -g @earendil-works/pi-coding-agent@latest
npx pi-persian-rtl-bundle doctor
npx pi-persian-rtl-bundle apply
npx pi-persian-rtl-bundle check
```

If `doctor` finds no bundle target, Pi changed its layout — open an issue with
the output of `doctor` and `npm ls -g @earendil-works/pi-coding-agent`.

## Adding an environment option

Environment variables are read **at call time**, not at patch time, so a mode
change takes effect without re-applying. Document any new variable in the
README table, the CLI `--help` text, and add a test that exercises it.

## Reporting caret/alignment problems

Caret placement is an approximation — terminals do not expose their BiDi
layout. If Persian text is misaligned or the caret is off, include:

* terminal name and version (Windows Terminal, GNOME/VTE, iTerm2, …);
* `PI_PERSIAN_RTL_MODE` / `PI_PERSIAN_RTL_ALIGN` / `PI_PERSIAN_RTL_CARET`;
* a short sample line that reproduces it, and a screenshot if possible.

Also try `PI_PERSIAN_RTL_ALIGN=left` and `PI_PERSIAN_RTL_CARET=off` first — that
tells us whether the padding or the mirroring is at fault.

## Pull requests

* Keep changes focused; one concern per PR.
* Update `CHANGELOG.md` under an `## Unreleased` heading.
* `npm run check` must pass.
* Do not reformat unrelated code.

## License

By contributing you agree your work is released under the MIT license in
[LICENSE](./LICENSE).
