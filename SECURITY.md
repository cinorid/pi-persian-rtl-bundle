# Security Policy

## What this package does

`pi-persian-rtl-bundle` **modifies files inside your Pi installation**. It:

* locates Pi's runtime bundle (`<pi-pkg>/dist/bundle/chunks/*.js`);
* writes a one-time backup next to each file it changes
  (`<file>.pi-persian-rtl-bundle.bak`);
* performs exact, reversible text substitutions in that file;
* writes atomically (temp file + rename).

It makes **no network requests** and has **no runtime dependencies**. It does not
read credentials, sessions, or conversation data.

Because it edits another program's code, you should review the source before
running it. The patch is applied to text you can diff yourself:

```sh
npx pi-persian-rtl-bundle apply
npx pi-persian-rtl-bundle check
npx pi-persian-rtl-bundle restore   # undo
```

## Supported versions

The latest published version on npm.

## Reporting a vulnerability

Report privately via GitHub Security Advisories:

<https://github.com/cinorid/pi-persian-rtl-bundle/security/advisories/new>

Please do not open a public issue for a security problem.

Include, where possible:

* affected version;
* what an attacker could achieve;
* reproduction steps or a proof of concept;
* whether the issue requires a malicious package, a malicious file in the Pi
  install, or only local access.

Expect an initial response within about 7 days. This is a volunteer project, so
please allow reasonable time before disclosing publicly.

## Scope

In scope:

* code execution or file writes outside the intended patch target;
* path traversal or symlink attacks in target discovery;
* writing to a file without first creating a backup;
* leaving a patched file in a state that breaks Pi startup;
* dependency or supply-chain issues.

Out of scope:

* **The fact that patching a bundle is unsupported.** A Pi update replacing the
  chunk and reverting the patch is expected behaviour, not a vulnerability.
* Terminal BiDi rendering differences, including caret placement.
* Anything requiring an attacker who can already write to your Pi installation
  or your npm global prefix — that is already game over.
* Bugs in Pi itself or in `pi-persian-rtl`. Report those upstream.
