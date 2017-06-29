#!/usr/bin/env node --harmony
const fs = require('fs');
const readline = require('readline');
const tty = require('tty');

const package = require('./package.json');

const fullArgs = process.argv.join(' ');

const OPT_OUTPUT_HELP = / -h\b| --help\b/.test(fullArgs);
const OPT_OUTPUT_INDEX = / -i\b/.test(fullArgs);
const OPT_MULTILINE = / -m\b/.test(fullArgs);
const OPT_OUTPUT_VERSION = / --version\b/.test(fullArgs);

if (OPT_OUTPUT_HELP) {
  process.stdout.write(`
Usage: ${ package.name } [OPTIONS]

${ package.description }

Options:

  -h, --help  output help
  -i          output line index instead of line
  -m          enable multiple line selection
  --version   output version

Controls:
  up          move cursor up
  down        move cursor down
  q           quit / cancel

Controls (single mode):
  c, enter    output highlighted line

Controls (multi mode):
  enter       add highlighted line to selection
  c           output selected lines
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
  '\u0003': 'quit', // escape
  'q': 'quit',
  'c': 'continue',
};

const ttyin = new tty.ReadStream(fs.openSync('/dev/tty', 'r'));
const ttyout = new tty.WriteStream(fs.openSync('/dev/tty', 'w'));

const getRows = () => ttyout.rows || process.stdout.rows || 10;
const getCols = () => ttyout.columns || process.stdout.columns || 50;
const getAction = (str, key) => ACTIONS[key.name] || ACTIONS[str];

const yellowBold = text => `\x1b[1m\x1b[33m${text}\x1b[0m`;
const yellow = text => `\x1b[33m${text}\x1b[0m`;
const bold = text => `\x1b[1m${text}\x1b[22m`;
const clearStyle = text => `${text}\x1b[0m`;
const id = text => text;

let selected = 0;
let multiSelectedOptions = {};
let rowOffset = 0;
let options;

main();

async function main() {
  options = await readOptions();
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
  ttyout.write(
    options.slice(rowOffset, rowOffset + getRows() - 2).map(formatLine).join('')
  );
}

function formatLine(option, optionIndex) {
  const i = optionIndex + rowOffset;
  // Determine whether to show the arrow pointing at the selected item
  const prefix = i === selected ? yellowBold('=>') : '  ';
  // Determine how to render the option text
  const isHightlighted = i === selected;
  const isMultiSelected = multiSelectedOptions[i];
  const isBoth = isHightlighted && isMultiSelected;
  const fn = isBoth
    ? yellowBold
    : isHightlighted ? bold : isMultiSelected ? yellow : id;
  const suffix = fn(`${i}: ${option.trim()}`);
  // Concatenate the prefix and suffix
  const line = `${prefix} ${suffix}`;
  const padding = getCols() - line.length;

  if (padding >= 0) {
    // Render the full line, padding with empty space to fill the column width
    return `${line}${' '.repeat(padding)}\n`;
  } else {
    // Render the line truncated, making sure to clear formatting.
    return `${clearStyle(line.slice(0, padding))}\n`;
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
    case 'select':
      return handleSelect();
    case 'continue':
      return handleContinue();
    default: {
      const val = parseInt(str, 10);
      if (val == str) return moveCursor(val - selected);
    }
  }
}

function end(output) {
  const rows = getRows() - 2;
  const height = Math.min(options.length, rows);

  readline.moveCursor(ttyout, 0, -height);
  readline.clearScreenDown(ttyout);

  if (output) {
    process.stdout.write(output);
  }

  process.exit();
}

function moveCursor(dir) {
  const _selected = Math.min(options.length - 1, Math.max(0, selected + dir));

  if (selected === _selected) {
    return;
  }

  const rows = getRows() - 2;
  const height = Math.min(options.length, rows);

  if (dir < 0 && _selected < rowOffset) {
    rowOffset = _selected;
  } else if (dir > 0 && _selected >= rowOffset + rows) {
    rowOffset = _selected - rows + 1;
  }

  selected = _selected;
  readline.moveCursor(ttyout, 0, -height);
  writeScreen(options, selected, multiSelectedOptions, rowOffset);
}

function handleSelect() {
  if (!OPT_MULTILINE) {
    return handleContinue();
  }

  const rows = getRows() - 2;
  const height = Math.min(options.length, rows);

  multiSelectedOptions[selected] = !multiSelectedOptions[selected];
  readline.moveCursor(ttyout, 0, -height);
  writeScreen(options, selected, multiSelectedOptions, rowOffset);
}

function handleContinue() {
  const output = getOutput();

  end(`${output}\n`);
}

function getOutput() {
  if (OPT_OUTPUT_INDEX) {
    if (OPT_MULTILINE) {
      return Object.entries(multiSelectedOptions)
        .filter(([key, value]) => value)
        .map(([key, value]) => key)
        .join('\n');
    } else {
      return selected;
    }
  } else {
    if (OPT_MULTILINE) {
      return options.filter((o, i) => !!multiSelectedOptions[i]).join('\n');
    } else {
      return options[selected];
    }
  }
}
