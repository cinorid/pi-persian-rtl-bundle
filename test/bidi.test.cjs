'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBidiTestRuntime } = require('../lib/bidi-source.cjs');

const RLI = '\u2067';
const PDI = '\u2069';

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
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

test('native mode right-aligns an RTL-first line and isolates it', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_ALIGN: undefined }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام دنیا', 40);
    assert.equal(out, ' '.repeat(31) + RLI + 'سلام دنیا' + PDI);
  });
});

test('native mode keeps logical order (no reversal)', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام دنیا', 40);
    assert.ok(out.includes('سلام دنیا'), 'logical text must be preserved verbatim');
    assert.ok(!out.includes('ایند مالس'), 'text must not be reversed');
  });
});

test('LTR-first lines are left untouched', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined }, () => {
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
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    assert.equal(applyBidiTerminalOutput('سلام دنیا', 40), RLI + 'سلام دنیا' + PDI);
  });
});

test('native mode preserves ANSI styling', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_ALIGN: undefined }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const styled = '\x1b[31mسلام\x1b[0m';
    const out = applyBidiTerminalOutput(styled, 20);
    assert.ok(out.includes(styled), 'ANSI sequence must survive');
    assert.equal(out, ' '.repeat(16) + RLI + styled + PDI);
  });
});

test('padding never goes negative on an over-wide line', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_ALIGN: undefined }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام دنیا', 4);
    assert.equal(out, RLI + 'سلام دنیا' + PDI);
  });
});

test('ZWNJ is preserved', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const word = 'می\u200cخواهم';
    const out = applyBidiTerminalOutput(word, 30);
    assert.ok(out.includes('\u200c'), 'ZWNJ must not be stripped');
    assert.ok(out.includes(word));
  });
});

test('caret column mirrors an RTL paragraph and includes the padding', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_ALIGN: undefined, PI_PERSIAN_RTL_CARET: undefined }, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    const line = 'سلام'; // 4 columns, width 40 => pad 36
    assert.equal(piFaCaretColumn('', line, 40), 40, 'logical 0 sits at the right edge');
    assert.equal(piFaCaretColumn('س', line, 40), 39);
    assert.equal(piFaCaretColumn('سل', line, 40), 38);
    assert.equal(piFaCaretColumn('سلام', line, 40), 36, 'logical end sits at the left edge of the content');
  });
});

test('caret column is unchanged for LTR-first lines and when disabled', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_ALIGN: undefined, PI_PERSIAN_RTL_CARET: undefined }, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    assert.equal(piFaCaretColumn('hel', 'hello سلام', 40), 3);
  });
  withEnv({ PI_PERSIAN_RTL_CARET: 'off' }, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    assert.equal(piFaCaretColumn('سل', 'سلام', 40), 2, 'disabled => raw logical column');
  });
});

test('caret column stays logical when alignment is left', () => {
  withEnv({ PI_PERSIAN_RTL_ALIGN: 'left', PI_PERSIAN_RTL_MODE: undefined, PI_PERSIAN_RTL_CARET: undefined }, () => {
    const { piFaCaretColumn } = createBidiTestRuntime();
    // No padding, but the isolate still mirrors the paragraph.
    assert.equal(piFaCaretColumn('', 'سلام', 40), 4);
    assert.equal(piFaCaretColumn('سلام', 'سلام', 40), 0);
  });
});

test('visual mode reorders the text', () => {
  withEnv({ PI_PERSIAN_RTL_MODE: 'visual', PI_PERSIAN_RTL_ALIGN: 'left' }, () => {
    const { applyBidiTerminalOutput } = createBidiTestRuntime();
    const out = applyBidiTerminalOutput('سلام', 40);
    assert.equal(out, 'مالس');
  });
});
