'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBidiTestRuntime } = require('../lib/bidi-source.cjs');

const RLI = '\u2067';
const PDI = '\u2069';

const BASE = {
  PI_PERSIAN_RTL_MODE: 'native',
  PI_PERSIAN_RTL_ALIGN: undefined,
  PI_PERSIAN_RTL_CARET: undefined,
  PI_PERSIAN_RTL_TERMINAL_BIDI: undefined,
  WT_SESSION: undefined,
  WT_PROFILE_ID: undefined,
};

function withEnv(values, fn) {
  const merged = { ...BASE, ...values };
  const saved = {};
  for (const key of Object.keys(merged)) {
    saved[key] = process.env[key];
    if (merged[key] === undefined) delete process.env[key];
    else process.env[key] = merged[key];
  }
  try {
    return fn();
  }
  finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Native mode (terminals that implement BiDi)
// ---------------------------------------------------------------------------

test('native mode right-aligns an RTL-first line and isolates it', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('سلام دنیا', 40), ' '.repeat(31) + RLI + 'سلام دنیا' + PDI);
  });
});

test('native mode keeps logical order (no reversal)', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام دنیا', 40);
    assert.ok(out.includes('سلام دنیا'), 'logical text must be preserved verbatim');
    assert.ok(!out.includes('ایند مالس'), 'text must not be reversed');
  });
});

test('LTR-first lines are left untouched', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('hello سلام', 40), 'hello سلام');
    assert.equal(applyBidiTerminalOutput('plain ascii', 40), 'plain ascii');
  });
});

test('mode=off is a pass-through', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'off' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('سلام دنیا', 40), 'سلام دنیا');
  });
});

test('align=left isolates without padding', () => {
  withEnv({ PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('سلام دنیا', 40), RLI + 'سلام دنیا' + PDI);
  });
});

test('native mode preserves ANSI styling', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const styled = '\x1b[31mسلام\x1b[0m';
    const out = applyBidiTerminalOutput(styled, 20);
    assert.ok(out.includes(styled), 'ANSI sequence must survive');
    assert.equal(out, ' '.repeat(16) + RLI + styled + PDI);
  });
});

test('padding never goes negative on an over-wide line', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('سلام دنیا', 4), RLI + 'سلام دنیا' + PDI);
  });
});

test('ZWNJ is preserved', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const word = 'می\u200cخواهم';
    const out = applyBidiTerminalOutput(word, 30);
    assert.ok(out.includes('\u200c'), 'ZWNJ must not be stripped');
    assert.ok(out.includes(word));
  });
});

// ---------------------------------------------------------------------------
// Regression: Pi's layout frame pre-pads every line to terminal width, so the
// padding must be RELOCATED, not appended.
// ---------------------------------------------------------------------------

test('right-aligns a line the layout frame already padded to full width', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    // A frame line: content already padded out to 40 columns.
    const frameLine = 'سلام دنیا' + ' '.repeat(31);
    const out = applyBidiTerminalOutput(frameLine, 40);
    assert.equal(out, ' '.repeat(31) + RLI + 'سلام دنیا' + PDI);
    // Same visible width as before: the text moved right, nothing was added.
    assert.ok(out.startsWith(' '.repeat(31) + RLI));
  });
});

test('pre-padded frame line and bare line produce identical output', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const bare = applyBidiTerminalOutput('سلام دنیا', 40);
    const framed = applyBidiTerminalOutput('سلام دنیا' + ' '.repeat(31), 40);
    assert.equal(framed, bare);
  });
});

test('trailing whitespace on a pre-padded line is trimmed, not doubled', () => {
  withEnv({}, () => {
    const { piFaTrimTrailingWhitespace } = createBidiTestRuntime();
    assert.equal(piFaTrimTrailingWhitespace('abc   '), 'abc');
    assert.equal(piFaTrimTrailingWhitespace('abc\t '), 'abc');
    assert.equal(piFaTrimTrailingWhitespace('abc'), 'abc');
    assert.equal(piFaTrimTrailingWhitespace('   '), '');
    // Trailing ANSI reset followed by frame padding: padding still goes away.
    assert.equal(piFaTrimTrailingWhitespace('\x1b[31mabc\x1b[0m   '), '\x1b[31mabc\x1b[0m');
  });
});

test('a non-RTL line keeps its original trailing padding', () => {
  withEnv({}, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const line = 'hello world' + ' '.repeat(9);
    assert.equal(applyBidiTerminalOutput(line, 20), line);
  });
});

// ---------------------------------------------------------------------------
// Visual mode (terminals WITHOUT BiDi, e.g. Windows Terminal)
// ---------------------------------------------------------------------------

test('visual mode reorders the text', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'visual', PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('سلام', 40), 'مالس');
  });
});

test('visual mode preserves ANSI colour across the reorder', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'visual', PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('\x1b[31mسلام\x1b[0m', 40);
    assert.ok(out.includes('\x1b[31m'), 'colour must survive the reorder');
    assert.ok(out.includes('مالس'), 'text must be reversed');
  });
});

test('visual mode keeps a mixed Persian/Latin run readable', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'visual', PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام abc', 40);
    // The Latin run stays in order; the Persian run is reversed.
    assert.ok(out.includes('abc'), 'Latin run must stay intact');
    assert.ok(out.includes('مالس'), 'Persian run must be reversed');
  });
});

test('visual mode right-aligns a pre-padded frame line', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'visual' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام دنیا' + ' '.repeat(31), 40);
    assert.equal(out, ' '.repeat(31) + 'ایند مالس');
  });
});

// ---------------------------------------------------------------------------
// Mode auto-detection
// ---------------------------------------------------------------------------

test('auto mode picks visual on Windows Terminal (no BiDi)', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, WT_SESSION: 'some-guid' }, () => {
    const { piFaMode } = createBidiTestRuntime();
    assert.equal(piFaMode(), 'visual');
  });
});

test('auto mode picks native where the terminal implements BiDi', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_TERMINAL_BIDI: 'true' }, () => {
    const { piFaMode } = createBidiTestRuntime();
    assert.equal(piFaMode(), 'native');
  });
});

test('explicit PI_PERSIAN_RTL_MODE always wins over detection', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'native', WT_SESSION: 'some-guid' }, () => {
    const { piFaMode } = createBidiTestRuntime();
    assert.equal(piFaMode(), 'native');
  });
  withEnv({ PI_PERSIAN_RTL_MODE: 'visual', PI_PERSIAN_RTL_TERMINAL_BIDI: 'true' }, () => {
    const { piFaMode } = createBidiTestRuntime();
    assert.equal(piFaMode(), 'visual');
  });
});

test('PI_PERSIAN_RTL_TERMINAL_BIDI overrides platform detection', () => {
  withEnv({ PI_PERSIAN_RTL_TERMINAL_BIDI: 'false' }, () => {
    const { piFaTerminalSupportsBidi } = createBidiTestRuntime();
    assert.equal(piFaTerminalSupportsBidi(), false);
  });
});

// ---------------------------------------------------------------------------
// Caret
// ---------------------------------------------------------------------------

test('caret column mirrors an RTL paragraph and includes the padding', () => {
  withEnv({}, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    const line = 'سلام'; // 4 columns, width 40 => pad 36
    assert.equal(piFaCaretColumn('', line, 40), 40, 'logical 0 sits at the right edge');
    assert.equal(piFaCaretColumn('س', line, 40), 39);
    assert.equal(piFaCaretColumn('سل', line, 40), 38);
    assert.equal(piFaCaretColumn('سلام', line, 40), 36, 'logical end sits at the left edge of the content');
  });
});

test('caret column is unchanged for LTR-first lines and when disabled', () => {
  withEnv({}, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    assert.equal(piFaCaretColumn('hel', 'hello سلام', 40), 3);
  });
  withEnv({ PI_PERSIAN_RTL_CARET: 'off' }, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    assert.equal(piFaCaretColumn('سل', 'سلام', 40), 2, 'disabled => raw logical column');
  });
});

test('caret column is stable for a frame-padded cursor line', () => {
  withEnv({}, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    assert.equal(piFaCaretColumn('', 'سلام' + ' '.repeat(36), 40), 40);
    assert.equal(piFaCaretColumn('سلام', 'سلام' + ' '.repeat(36), 40), 36);
  });
});

test('caret column stays logical when alignment is left', () => {
  withEnv({ PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    assert.equal(piFaCaretColumn('', 'سلام', 40), 4);
    assert.equal(piFaCaretColumn('سلام', 'سلام', 40), 0);
  });
});
