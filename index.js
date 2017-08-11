#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');
const tty = require('tty');

const package = require('./package.json');

const fullArgs = process.argv.join(' ');

const READING_FROM_PIPE = !process.stdin.isTTY;
const WRITING_TO_PIPE = !process.stdout.isTTY;
const CALLED_VIA_CLI = require.main === module;

const TAB_WIDTH = 8;

let OPT_OUTPUT_HELP = / -h\b| --help\b/.test(fullArgs);
let OPT_OUTPUT_INDEX = / -i\b/.test(fullArgs);
let OPT_MULTILINE = / -m\b/.test(fullArgs);
let OPT_OUTPUT_VERSION = / --version\b/.test(fullArgs);
let OPT_HIDE_SELECTION_NUMBERS = / --hide-numbers\b/.test(fullArgs);
let OPT_PRESERVE_SELECTION_ORDER = / --preserve-order\b/.test(fullArgs);
let OPT_COMPACT = / -c\b| --compact\b/.test(fullArgs);

if (OPT_OUTPUT_HELP) {
  process.stdout.write(`
Usage: ${ package.name } [OPTIONS]

${ package.description }

Options:

  -h, --help        output help
  -i                output line index instead of line
  -m                enable multiple line selection
  --hide-numbers    hide selection number prefix
  --preserve-order  output lines in order of selection
  -c, --compact     separate options by tabs instead of newlines
  --version         output version

Controls:
  up                move cursor up
  down              move cursor down
  q                 quit / cancel

Controls (single mode):
  c, s, enter          output highlighted line

Controls (multi mode):
  s, enter          add highlighted line to selection
                    shift + s to select range
  c                 output selected lines
`);
  return;
}

if (OPT_OUTPUT_VERSION) {
  process.stdout.write(`
${ package.version }
`);
  return;
}

const ACTIONS = {
  'up': 'cursorUp',
  'down': 'cursorDown',
  'return': 'select',
  's': 'select',
  '\u0003': 'quit', // escape
  'q': 'quit',
  'c': 'continue',
};

let ttyin;
let ttyout;

const getRows = () => ttyout.rows || process.stdout.rows || 10;
const getCols = () => ttyout.columns || process.stdout.columns || 50;
const getAction = (str, key) => ACTIONS[key.name] || ACTIONS[str];

function getHeight() {
  const rows = getRows() - 2;

  if (OPT_COMPACT) {
    const chars =
      options.map(option => option.length + TAB_WIDTH - (option.length % TAB_WIDTH))
             .reduce((sum, width) => sum + width);
    const optionRows = Math.ceil(chars / getCols()) - 1;
    return Math.min(optionRows, rows);
  } else {
    return Math.min(options.length, rows);
  }
}

// https://en.wikipedia.org/wiki/ANSI_escape_code
const AnsiColorCodes = {
  reset: '[0m',
  bold: '[1m',
  black: '[30m',
  magenta: '[35m',
  yellow: '[33m',
  bgMagenta: '[45m',
  bgWhite: '[47m',
  bgBrightMagenta: '[105m',
  bgBrightWhite: '[107m',
};

const Style = new Proxy(AnsiColorCodes, {
  get(target, property, reciever) {
    return `\x1b${target[property]}`;
  },
});

const clearStyle = text => text + Style.reset;
const id = text => text;
const styleHighlightedSelected = text => Style.bgBrightMagenta + Style.black + text + Style.reset;
const styleHighlighted = text => Style.bgBrightWhite + Style.black + text + Style.reset;
const styleSelected = text => Style.magenta + text + Style.reset;

let selected = 0;
let lastSelected = 0;
let selectionIndex = 1;
let multiSelectedOptions = {};
let rowOffset = 0;
let options;
let progResolve;

if (CALLED_VIA_CLI) {
  cliMain();
} else {
  module.exports = async function(passedOptions, flags) {
    if (progResolve !== undefined) {
      throw new Error('seline already in use!');
    }

    options = passedOptions;

    if (flags) {
      if (flags.multiline) OPT_MULTILINE = flags.multiline;
      if (flags.outputIndex) OPT_OUTPUT_INDEX = flags.outputIndex;
      if (flags.hideNumbers) OPT_HIDE_SELECTION_NUMBERS = flags.hideNumbers;
      if (flags.preserveOrder) OPT_PRESERVE_SELECTION_ORDER = flags.preserveOrder;
      if (flags.compact) OPT_COMPACT = flags.compact;
    }

    return new Promise((resolve, reject) => {
      progResolve = resolve;
      main();
    });
  };
}

async function cliMain() {
  options = await readOptions();
  main();
}

function main() {
  ttyin = new tty.ReadStream(fs.openSync('/dev/tty', 'r'));
  ttyout = new tty.WriteStream(fs.openSync('/dev/tty', 'w'));
  writeScreen();
  ttyin.setRawMode(true);
  readline.emitKeypressEvents(ttyin);
  ttyin.on('keypress', handleInput);  
}

async function readOptions() {
  return new Promise((resolve, reject) => {
    const options = [];
    const input = process.stdin;
    const rl = readline.createInterface({ input });

    rl.on('line', chunk => options.push(chunk));
    rl.on('close', () => resolve(options));
  });
}

function writeScreen() {
  if (OPT_COMPACT) {
    ttyout.write(
      options.map(formatLine).join('')
    );
  } else {
    ttyout.write(
      options.slice(rowOffset, rowOffset + getRows() - 2).map(formatLine).join('')
    );
  }
}

function formatLine(option, optionIndex) {
  const i = optionIndex + rowOffset;
  // Determine how to render the option text
  const isHightlighted = i === selected;
  const isMultiSelected = !!multiSelectedOptions[i];
  const isBoth = isHightlighted && isMultiSelected;
  const fn = isBoth
    ? styleHighlightedSelected
    : isHightlighted ? styleHighlighted : isMultiSelected ? styleSelected : id;

  let line = option.trim();

  if (!OPT_COMPACT) {
    if (OPT_PRESERVE_SELECTION_ORDER && isMultiSelected) {
      line = `(${multiSelectedOptions[i]}) ${line}`;
    }
    if (!OPT_HIDE_SELECTION_NUMBERS) {
      line = `${i}: ${line}`;
    }
  }

  line = fn(line);

  const terminal = OPT_COMPACT ? '\t' : '\n';
  const padding = OPT_COMPACT ? 0 : getCols() - line.length;

  if (padding >= 0) {
    // Render the full line, padding with empty space to fill the column width
    return `${line}${' '.repeat(padding)}${terminal}`;
  } else {
    // Render the line truncated, making sure to clear formatting.
    return `${clearStyle(line.slice(0, padding))}${terminal}`;
  }
}

function handleInput(str, key) {
  const action = getAction(str, key);

  switch (action) {
    case 'quit':
      return end();
    case 'cursorUp':
      return moveCursor(-1);
    case 'cursorDown':
      return moveCursor(1);
    case 'select': {
      return handleSelect(!!key.shift);
    }
    case 'continue':
      return handleContinue();
    default: {
      const val = parseInt(str, 10);
      if (val == str) return moveCursor(val - selected);
    }
  }
}

function end(output) {
  const height = getHeight();

  if (OPT_COMPACT) {
    readline.cursorTo(ttyout, 0);
  }
  readline.moveCursor(ttyout, 0, -height);
  readline.clearScreenDown(ttyout);

  if (CALLED_VIA_CLI) {
    if (output) {
      process.stdout.write(`${output}\n`);
    }
  } else {
    progResolve(output);
    options = undefined;
    progResolve = undefined;
    OPT_MULTILINE = false;
    OPT_OUTPUT_INDEX = false;
    OPT_HIDE_SELECTION_NUMBERS = false;
    OPT_PRESERVE_SELECTION_ORDER = false;
    OPT_COMPACT = false;
  }

  if (CALLED_VIA_CLI) {
    process.exit();
  } else {
    try {
      ttyin.destroy();
      ttyout.destroy();
    } catch (err) {
      console.warn('Could not destroy tty streams! Killing process');
      process.exit(); 
    }
  }
}

function moveCursor(dir) {
  const _selected = Math.min(options.length - 1, Math.max(0, selected + dir));

  if (selected === _selected) {
    return;
  }

  const rows = getRows() - 2;
  const height = getHeight();

  // TODO - scolling in COMPACT mode is probably broken
  if (dir < 0 && _selected < rowOffset) {
    rowOffset = _selected;
  } else if (dir > 0 && _selected >= rowOffset + rows) {
    rowOffset = _selected - rows + 1;
  }
  selected = _selected;

  if (OPT_COMPACT) {
    readline.cursorTo(ttyout, 0);
  }
  readline.moveCursor(ttyout, 0, -height);
  writeScreen(options, selected, multiSelectedOptions, rowOffset);
}

function handleSelect(shiftSelect) {
  if (!OPT_MULTILINE) {
    return handleContinue();
  }

  height = getHeight();

  if (!shiftSelect || lastSelected === selected) {
    const isSelected = !!multiSelectedOptions[selected];
    applySelection(selected, isSelected);
  } else {
    const isSelected = !multiSelectedOptions[lastSelected];
    const iterDirection = selected > lastSelected ? 1 : -1;
    for (let i = lastSelected; i !== selected; i += iterDirection) {
      applySelection(i, isSelected);
    }
    applySelection(selected, isSelected);
  }

  lastSelected = selected;

  if (OPT_MULTILINE && OPT_PRESERVE_SELECTION_ORDER) {
    let entries = Object.entries(multiSelectedOptions).filter(([key, val]) => !!val);
    entries.sort((a, b) => {
      return a[1] - b[1];
    });
    entries.forEach(([key], index) => {
      multiSelectedOptions[key] = index + 1;
    });
    selectionIndex = entries.length + 1;
  }

  if (OPT_COMPACT) {
    readline.cursorTo(ttyout, 0);
  }
  readline.moveCursor(ttyout, 0, -height);
  writeScreen(options, selected, multiSelectedOptions, rowOffset);
}

function applySelection(index, isSelected) {
  if (isSelected) {
    multiSelectedOptions[index] = 0;
  } else {
    multiSelectedOptions[index] = selectionIndex;
    selectionIndex += 1;
  }
}

function handleContinue() {
  const output = getOutput();

  end(output);
}

function getOutput() {
  if (OPT_OUTPUT_INDEX) {
    if (OPT_MULTILINE) {
      const entries = Object.entries(multiSelectedOptions)
        .filter(([key, value]) => value)
        .map(([key, value]) => key);
      if (CALLED_VIA_CLI) {
        return entries.join('\n');
      } else {
        return entries;
      }
    } else {
      return selected;
    }
  } else {
    if (OPT_MULTILINE) {
      let entries;
      if (OPT_PRESERVE_SELECTION_ORDER) {
        entries = [];
        Object.entries(multiSelectedOptions).forEach(([key, value]) => {
          if (!value) return;
          entries[value] = options[key];
        });
        entries = entries.filter(val => !!val);
      } else {
        entries = options.filter((o, i) => !!multiSelectedOptions[i]);
      }

      if (CALLED_VIA_CLI) {
        return entries.join('\n');
      } else {
        return entries;
      }
    } else {
      return options[selected];
    }
  }
}
