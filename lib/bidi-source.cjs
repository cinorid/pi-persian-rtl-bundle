'use strict';

/**
 * BiDi helper source that gets injected into Pi's *runtime bundle*.
 *
 * Unlike the upstream pi-persian-rtl patch, this block is injected into the
 * minified `dist/bundle/chunks/chunk-*.js` file that Pi actually executes.
 *
 * The block is self-contained except for three helpers that already live in
 * the host module scope of that chunk (verified present in Pi 1.0.0):
 *
 *   normalizeTerminalOutput(str) -> string
 *   visibleWidth(str)            -> number   (ANSI-aware)
 *   extractAnsiCode(str, i)      -> { length } | undefined
 *
 * It deliberately does NOT rely on the host's `graphemeSegmenter` binding:
 * the bundle contains more than one module region and a second
 * `var graphemeSegmenter` exists further down the file, so depending on it
 * would be fragile. We own our segmenter instead.
 *
 * Two hard-won details are encoded here:
 *
 * 1. Pi's layout frame (renderLayoutFrame -> paintBox) pads every line to the
 *    full terminal width BEFORE applyLineResets runs. So the line arrives
 *    already `columns` wide and a naive `columns - visibleWidth(line)` padding
 *    is always 0. Trailing whitespace must be moved to the front, not added.
 *
 * 2. Windows Terminal does not implement the Unicode Bidirectional Algorithm
 *    (microsoft/terminal#538 is still open), so RLI/PDI are inert there and
 *    text stays in logical order - which reads as reversed. Those terminals
 *    need application-side reordering, so the default mode is chosen from the
 *    terminal rather than assumed.
 */

/**
 * Version-independent marker prefix.
 *
 * Stripping MUST match on the prefix, not the full start marker: otherwise
 * bumping the version makes an older patch block unrecognisable and a
 * re-apply leaves two copies of the helpers behind ("Identifier already
 * declared").
 */
const PERSIAN_BIDI_PATCH_START_PREFIX = '// PI_PERSIAN_RTL_BUNDLE_PATCH_START';
const PERSIAN_BIDI_PATCH_START = `${PERSIAN_BIDI_PATCH_START_PREFIX} v1.1.0`;
const PERSIAN_BIDI_PATCH_END = '// PI_PERSIAN_RTL_BUNDLE_PATCH_END';

const PERSIAN_BIDI_BODY = String.raw`
const PI_FA_SEGMENTER = new Intl.Segmenter("fa", { granularity: "grapheme" });
const PI_FA_RTL_LETTER_REGEX = /(?=\p{Script=Arabic})\p{Letter}/u;
const PI_FA_ANY_LETTER_REGEX = /\p{Letter}/u;
const PI_FA_DIGIT_REGEX = /[0-9\u0660-\u0669\u06f0-\u06f9]/u;
const PI_FA_MARK_OR_JOINER_REGEX = /(?:\p{Mark}|[\u200c\u200d\u2060])/u;
const PI_FA_NUMERIC_PUNCT_REGEX = /^[+\-.,:،؛؟٪%\/\u066a\u066b\u066c]+$/u;
const PI_FA_WHITESPACE_REGEX = /^\s+$/u;
const PI_FA_RLI = "\u2067";
const PI_FA_PDI = "\u2069";
const PI_FA_SGR_RESET = "\u001b[0m";

function piFaStripEscapes(str) {
    let out = "";
    let i = 0;
    while (i < str.length) {
        const ansi = extractAnsiCode(str, i);
        if (ansi) {
            i += ansi.length;
            continue;
        }
        out += str[i];
        i++;
    }
    return out;
}

/**
 * Terminals that implement the Unicode Bidirectional Algorithm.
 *
 * Windows Terminal does not (microsoft/terminal#538, open since 2019) and
 * neither does conhost, so on Windows the logical-order output would render
 * reversed. Everywhere else we assume the terminal can do it.
 */
function piFaTerminalSupportsBidi() {
    if (process.env.PI_PERSIAN_RTL_TERMINAL_BIDI === "1" || process.env.PI_PERSIAN_RTL_TERMINAL_BIDI === "true")
        return true;
    if (process.env.PI_PERSIAN_RTL_TERMINAL_BIDI === "0" || process.env.PI_PERSIAN_RTL_TERMINAL_BIDI === "false")
        return false;
    if (process.env.WT_SESSION || process.env.WT_PROFILE_ID)
        return false;
    return process.platform !== "win32";
}

function piFaMode() {
    const configured = (process.env.PI_PERSIAN_RTL_MODE || "").trim().toLowerCase();
    if (configured === "off" || configured === "none" || configured === "disabled")
        return "off";
    if (configured === "visual" || configured === "fallback" || configured === "legacy")
        return "visual";
    if (configured === "native" || configured === "bidi")
        return "native";
    // No explicit choice: pick what the terminal can actually render.
    return piFaTerminalSupportsBidi() ? "native" : "visual";
}

function piFaAlign() {
    const configured = (process.env.PI_PERSIAN_RTL_ALIGN || "right").trim().toLowerCase();
    if (configured === "left" || configured === "none" || configured === "off")
        return "left";
    return "right";
}

function piFaCaretFixEnabled() {
    const configured = (process.env.PI_PERSIAN_RTL_CARET || "on").trim().toLowerCase();
    return !(configured === "off" || configured === "none" || configured === "disabled" || configured === "0" || configured === "false");
}

/**
 * Drop trailing spaces/tabs from a raw line.
 *
 * Pi's layout frame pads lines out to the terminal width before we see them,
 * so the right-alignment padding has to be relocated, not appended.
 */
function piFaTrimTrailingWhitespace(str) {
    let end = str.length;
    while (end > 0) {
        const ch = str[end - 1];
        if (ch === " " || ch === "\t")
            end--;
        else
            break;
    }
    return end === str.length ? str : str.slice(0, end);
}

function piFaRawDirection(segment) {
    if (PI_FA_DIGIT_REGEX.test(segment))
        return "digit";
    if (PI_FA_RTL_LETTER_REGEX.test(segment))
        return "rtl";
    if (PI_FA_ANY_LETTER_REGEX.test(segment))
        return "ltr";
    if (PI_FA_MARK_OR_JOINER_REGEX.test(segment))
        return "joiner";
    return "neutral";
}

function piFaFirstStrongDirection(units) {
    for (const unit of units) {
        if (unit.raw === "rtl")
            return "rtl";
        if (unit.raw === "ltr")
            return "ltr";
    }
    return "ltr";
}

function piFaNearestDirection(units, index, step) {
    for (let i = index + step; i >= 0 && i < units.length; i += step) {
        const dir = units[i].dir;
        if (dir === "rtl" || dir === "ltr")
            return dir;
    }
    return undefined;
}

function piFaNearestRaw(units, index, step) {
    for (let i = index + step; i >= 0 && i < units.length; i += step) {
        const raw = units[i].raw;
        if (raw !== "neutral" && raw !== "joiner")
            return raw;
        if (!PI_FA_WHITESPACE_REGEX.test(units[i].text))
            return raw;
    }
    return undefined;
}

function piFaResolveDirections(inputUnits, baseDirection) {
    const units = inputUnits.map((unit) => ({ ...unit, dir: unit.raw === "digit" ? "ltr" : unit.raw }));

    for (let i = 0; i < units.length; i++) {
        if (units[i].raw !== "joiner")
            continue;
        const prev = piFaNearestDirection(units, i, -1);
        const next = piFaNearestDirection(units, i, 1);
        units[i].dir = prev === "rtl" || next === "rtl" ? "rtl" : (prev || next || baseDirection);
    }

    for (let i = 0; i < units.length; i++) {
        if (units[i].raw !== "neutral")
            continue;
        if (!PI_FA_NUMERIC_PUNCT_REGEX.test(units[i].text))
            continue;
        const prevRaw = piFaNearestRaw(units, i, -1);
        const nextRaw = piFaNearestRaw(units, i, 1);
        if (prevRaw === "digit" || nextRaw === "digit")
            units[i].dir = "ltr";
    }

    for (let i = 0; i < units.length; i++) {
        if (units[i].dir === "rtl" || units[i].dir === "ltr")
            continue;
        const prev = piFaNearestDirection(units, i, -1);
        const next = piFaNearestDirection(units, i, 1);
        units[i].dir = prev && prev === next ? prev : baseDirection;
    }

    return units;
}

function piFaReverseUnits(units) {
    return units.slice().reverse();
}

function piFaReorderRtlUnits(inputUnits) {
    const units = piFaResolveDirections(inputUnits, "rtl");
    const runs = [];
    let current = [];
    let currentDirection;

    const flush = () => {
        if (current.length > 0) {
            runs.push({ dir: currentDirection, units: current });
            current = [];
            currentDirection = undefined;
        }
    };

    for (const unit of units) {
        if (currentDirection === undefined || currentDirection === unit.dir) {
            current.push(unit);
            currentDirection = unit.dir;
        }
        else {
            flush();
            current.push(unit);
            currentDirection = unit.dir;
        }
    }
    flush();

    const visual = [];
    for (const run of runs.reverse()) {
        visual.push(...(run.dir === "rtl" ? piFaReverseUnits(run.units) : run.units));
    }
    return visual;
}

function piFaReorderLtrUnits(units) {
    const visual = [];
    let i = 0;

    while (i < units.length) {
        if (units[i].raw !== "rtl") {
            visual.push(units[i]);
            i++;
            continue;
        }

        let end = i + 1;
        while (end < units.length && units[end].raw !== "ltr")
            end++;

        let contentEnd = end;
        while (contentEnd > i && PI_FA_WHITESPACE_REGEX.test(units[contentEnd - 1].text))
            contentEnd--;

        visual.push(...piFaReorderRtlUnits(units.slice(i, contentEnd)));
        visual.push(...units.slice(contentEnd, end));
        i = end;
    }

    return visual;
}

function piFaPushTextUnits(units, text, code) {
    for (const { segment } of PI_FA_SEGMENTER.segment(text)) {
        let buffered = "";
        for (const character of segment) {
            if (character === "\u200c" || character === "\u200d") {
                if (buffered) {
                    units.push({ text: buffered, raw: piFaRawDirection(buffered), code });
                    buffered = "";
                }
                units.push({ text: character, raw: "joiner", code });
            }
            else {
                buffered += character;
            }
        }
        if (buffered)
            units.push({ text: buffered, raw: piFaRawDirection(buffered), code });
    }
}

function piFaTextUnits(str) {
    const units = [];
    piFaPushTextUnits(units, str, "");
    return units;
}

/**
 * Grapheme units that carry the ANSI state in effect at their position, so the
 * visual fallback can reorder text without discarding colour.
 */
function piFaStyledTextUnits(str) {
    const units = [];
    let code = "";
    let text = "";
    let i = 0;
    while (i < str.length) {
        const ansi = extractAnsiCode(str, i);
        if (ansi) {
            if (text) {
                piFaPushTextUnits(units, text, code);
                text = "";
            }
            code += ansi.code;
            i += ansi.length;
            continue;
        }
        text += str[i];
        i++;
    }
    if (text)
        piFaPushTextUnits(units, text, code);
    return units;
}

function piFaEmitUnits(units) {
    let out = "";
    let active;
    for (const unit of units) {
        if (unit.code !== active) {
            // Reset first so a style never bleeds into a reordered neighbour.
            out += (active === undefined ? "" : PI_FA_SGR_RESET) + unit.code;
            active = unit.code;
        }
        out += unit.text;
    }
    return out;
}

function piFaSafeWidth(width) {
    return Number.isFinite(width) ? Math.max(0, width) : undefined;
}

function piFaRightPad(plain, width) {
    if (piFaAlign() !== "right")
        return 0;
    const safeWidth = piFaSafeWidth(width);
    const pad = (safeWidth === undefined ? visibleWidth(plain) : safeWidth) - visibleWidth(plain);
    return Math.max(0, pad);
}

/**
 * Decide whether a line should be treated as an RTL paragraph.
 * Returns the escape-free text plus its grapheme units when it is.
 */
function piFaRtlLineInfo(normalized) {
    const plain = piFaStripEscapes(normalized);
    if (!PI_FA_RTL_LETTER_REGEX.test(plain))
        return undefined;
    const units = piFaTextUnits(plain);
    if (piFaFirstStrongDirection(units) !== "rtl")
        return undefined;
    return { plain, units };
}

function applyBidiTerminalOutput(str, width) {
    const normalized = normalizeTerminalOutput(str);
    const mode = piFaMode();
    if (mode === "off")
        return normalized;

    // Move the frame's trailing padding to the front instead of adding more.
    const body = piFaTrimTrailingWhitespace(normalized);
    const info = piFaRtlLineInfo(body);
    if (!info)
        return normalized;

    const pad = " ".repeat(piFaRightPad(info.plain, width));

    if (mode === "visual") {
        // Application-side reordering for terminals without BiDi. Colour is
        // preserved by carrying the ANSI state with each grapheme.
        const styled = piFaStyledTextUnits(body);
        const visualUnits = piFaFirstStrongDirection(styled) === "rtl"
            ? piFaReorderRtlUnits(styled)
            : piFaReorderLtrUnits(styled);
        return pad + piFaEmitUnits(visualUnits);
    }

    // Native mode: keep logical Unicode order. The terminal's own BiDi engine
    // reorders it; RLI/PDI only establish the paragraph boundary.
    return pad + PI_FA_RLI + body + PI_FA_PDI;
}

/**
 * Correct the caret column for a right-aligned, RTL-isolated line.
 *
 * Pi computes the cursor column in extractCursorPosition() and only then
 * applies line padding in applyLineResets(), so the padding shifts the text
 * out from under the caret. Additionally, an RTL paragraph mirrors the glyph
 * order, so a logical caret at index k lands at visual column (total - k).
 *
 *   0 (before the first logical char) -> right edge of the content
 *   n (after the last logical char)   -> left edge of the content
 */
function piFaCaretColumn(beforeMarker, fullLine, width) {
    const logical = visibleWidth(beforeMarker);
    if (!piFaCaretFixEnabled())
        return logical;
    if (piFaMode() === "off")
        return logical;

    const body = piFaTrimTrailingWhitespace(normalizeTerminalOutput(fullLine));
    const info = piFaRtlLineInfo(body);
    if (!info)
        return logical;

    const total = visibleWidth(info.plain);
    const pad = piFaRightPad(info.plain, width);
    return pad + Math.max(0, total - logical);
}
`;

const PERSIAN_BIDI_HELPERS = [
  PERSIAN_BIDI_PATCH_START,
  PERSIAN_BIDI_BODY.replace(/^\n/u, ''),
  PERSIAN_BIDI_PATCH_END,
].join('\n');

/**
 * Build the helper block in a sandbox for unit testing.
 *
 * `extractAnsiCode` is modelled as an object with `.length`, matching Pi's
 * bundled implementation (the non-bundled pi-tui returns a plain string; both
 * work because the helpers only read `.length`).
 */
function createBidiTestRuntime(overrides = {}) {
  const source = PERSIAN_BIDI_BODY
    .concat('\nreturn { applyBidiTerminalOutput, piFaCaretColumn, piFaMode, piFaAlign, piFaRightPad, piFaRtlLineInfo, piFaTrimTrailingWhitespace, piFaStyledTextUnits, piFaEmitUnits, piFaTerminalSupportsBidi, piFaReorderRtlUnits, piFaTextUnits };\n');

  const graphemeSegmenter = new Intl.Segmenter('fa', { granularity: 'grapheme' });
  const normalizeTerminalOutput = overrides.normalizeTerminalOutput ?? ((value) => value);
  const extractAnsiCode = overrides.extractAnsiCode ?? ((value, index) => {
    if (value.charCodeAt(index) !== 0x1b) return undefined;
    const rest = value.slice(index);
    const csi = /^\x1b\[[0-?]*[ -/]*[@-~]/u.exec(rest);
    if (csi) return { code: csi[0], length: csi[0].length };
    const osc = /^\x1b\][^\x07]*(?:\x07|\x1b\\)/u.exec(rest);
    return osc ? { code: osc[0], length: osc[0].length } : undefined;
  });
  // Narrow-column approximation: one column per grapheme cluster, escape
  // sequences and joiner/mark-only clusters contribute zero.
  const visibleWidth = overrides.visibleWidth ?? ((value) => {
    let text = '';
    let i = 0;
    while (i < value.length) {
      const ansi = extractAnsiCode(value, i);
      if (ansi) {
        i += ansi.length;
        continue;
      }
      text += value[i];
      i += 1;
    }
    let width = 0;
    for (const { segment } of graphemeSegmenter.segment(text)) {
      if (/^[\u200c\u200d\u2060\p{Mark}]+$/u.test(segment)) continue;
      width += 1;
    }
    return width;
  });

  const factory = new Function(
    'normalizeTerminalOutput',
    'visibleWidth',
    'extractAnsiCode',
    source,
  );

  return factory(normalizeTerminalOutput, visibleWidth, extractAnsiCode);
}

module.exports = {
  PERSIAN_BIDI_BODY,
  PERSIAN_BIDI_HELPERS,
  PERSIAN_BIDI_PATCH_START,
  PERSIAN_BIDI_PATCH_START_PREFIX,
  PERSIAN_BIDI_PATCH_END,
  createBidiTestRuntime,
};
