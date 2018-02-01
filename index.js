#!/usr/bin/env node
const fs       = require('fs');
const readline = require('readline');
const tty      = require('tty');

const package  = require('./package.json');


const READING_FROM_PIPE = !process.stdin.isTTY;
const WRITING_TO_PIPE   = !process.stdout.isTTY;
const CALLED_VIA_CLI    = require.main === module;

const TAB_WIDTH = 8;

const fullArgs = process.argv.join(' ');

const CLI_OPT_OUTPUT_HELP     = / -h\b| --help\b/     .test(fullArgs);
const CLI_OPT_OUTPUT_INDEX    = / -i\b/               .test(fullArgs);
const CLI_OPT_MULTILINE       = / -m\b/               .test(fullArgs);
const CLI_OPT_OUTPUT_VERSION  = / --version\b/        .test(fullArgs);
const CLI_OPT_HIDE_NUMBERS    = / --hide-numbers\b/   .test(fullArgs);
const CLI_OPT_PRESERVE_ORDER  = / --preserve-order\b/ .test(fullArgs);
const CLI_OPT_COMPACT         = / -c\b| --compact\b/  .test(fullArgs);


if (CLI_OPT_OUTPUT_HELP) {
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
  up, left          move cursor up
  down, right       move cursor down
  q                 quit / cancel
  u                 move highlighted line up
  d                 move highlighted line down

Controls (single mode):
  c, s, enter          output highlighted line

Controls (multi mode):
  s, enter          add highlighted line to selection
                    shift + s to select range
  c                 output selected lines
`);
  return;
}

if (CLI_OPT_OUTPUT_VERSION) {
  process.stdout.write(`
${ package.version }
`);
  return;
}


const progOpts = {
};

function setProgramOptions(opts) {
  opts = opts || {};

  progOpts.multiline      = 'multiline'     in opts ? opts.multiline      : CLI_OPT_MULTILINE;
  progOpts.outputIndex    = 'outputIndex'   in opts ? opts.outputIndex    : CLI_OPT_OUTPUT_INDEX;
  progOpts.hideNumbers    = 'hideNumbers'   in opts ? opts.hideNumbers    : CLI_OPT_HIDE_NUMBERS;
  progOpts.preserveOrder  = 'preserveOrder' in opts ? opts.preserveOrder  : CLI_OPT_PRESERVE_ORDER;
  progOpts.compact        = 'compact'       in opts ? opts.compact        : CLI_OPT_COMPACT;
}


const ACTIONS = {
  'up'      : 'cursorUp',
  'down'    : 'cursorDown',
  'left'    : 'cursorUp',
  'right'   : 'cursorDown',
  'return'  : 'select',
  's'       : 'select',
  '\u0003'  : 'quit', // escape
  'q'       : 'quit',
  'c'       : 'continue',
  'u'       : 'moveUp',
  'd'       : 'moveDown',
};

const getAction = (str, key) => ACTIONS[str] || ACTIONS[key.name];


let ttyin;
let ttyout;

const getRows = () => ttyout.rows    || process.stdout.rows    || 10;
const getCols = () => ttyout.columns || process.stdout.columns || 50;

function getHeight() {
  const rows = getRows() - 2;

  if (progOpts.compact) {
    const chars =
      choices.map(option => option.length + TAB_WIDTH - (option.length % TAB_WIDTH))
             .reduce((sum, width) => sum + width);
    const optionRows = Math.ceil(chars / getCols()) - 1;
    return Math.min(optionRows, rows);
  } else {
    return Math.min(choices.length, rows);
  }
}

// https://en.wikipedia.org/wiki/ANSI_escape_code
const AnsiColorCodes = {
  reset           : '[0m',
  bold            : '[1m',
  black           : '[30m',
  magenta         : '[35m',
  yellow          : '[33m',
  bgMagenta       : '[45m',
  bgWhite         : '[47m',
  bgBrightMagenta : '[105m',
  bgBrightWhite   : '[107m',
};

const Style = new Proxy(AnsiColorCodes, {
  get(target, property, reciever) {
    return `\x1b${target[property]}`;
  },
});

const id                       = text => text;
const clearStyle               = text => text + Style.reset;
const styleHighlightedSelected = text => Style.bgBrightMagenta + Style.black + text + Style.reset;
const styleHighlighted         = text => Style.bgBrightWhite + Style.black + text + Style.reset;
const styleSelected            = text => Style.magenta + text + Style.reset;


let selected       = 0;
let lastSelected   = 0;
let selectionIndex = 1;
let rowOffset      = 0;

let multiSelectedOptions = {};

let choices;
let progResolve;

if (CALLED_VIA_CLI) {
  setProgramOptions();
  cliMain();
} else {
  module.exports = async function(passedChoices, options) {
    if (progResolve !== undefined) {
      throw new Error('seline already in use!');
    }

    choices = passedChoices;
    setProgramOptions(options);

    return new Promise((resolve, reject) => {
      progResolve = resolve;
      main();
    });
  };
}


async function cliMain() {
  choices = await readChoices();
  main();
}

function main() {
  ttyin  = new tty.ReadStream(fs.openSync('/dev/tty', 'r'));
  ttyout = new tty.WriteStream(fs.openSync('/dev/tty', 'w'));
  writeScreen();
  ttyin.setRawMode(true);
  readline.emitKeypressEvents(ttyin);
  ttyin.on('keypress', handleInput);  
}

async function readChoices() {
  return new Promise((resolve, reject) => {
    const lines = [];
    const input = process.stdin;
    const rl = readline.createInterface({ input });

    rl.on('line', chunk => lines.push(chunk));
    rl.on('close', () => resolve(lines));
  });
}

function writeScreen() {
  if (progOpts.compact) {
    ttyout.write(
      choices.map(formatLine).join('')
    );
  } else {
    ttyout.write(
      choices.slice(rowOffset, rowOffset + getRows() - 2).map(formatLine).join('')
    );
  }
}

function formatLine(option, optionIndex) {
  const i = optionIndex + rowOffset;
  // Determine how to render the option text
  const isHightlighted  = i === selected;
  const isMultiSelected = !!multiSelectedOptions[i];
  
  let fn = id;
  if (isHightlighted && isMultiSelected) {
    fn = styleHighlightedSelected;
  } else if (isHightlighted) {
    fn = styleHighlighted;
  } else if (isMultiSelected) {
    fn = styleSelected;
  }

  let line = option.trim();

  if (!progOpts.compact) {
    if (progOpts.preserveOrder && isMultiSelected) {
      line = `(${multiSelectedOptions[i]}) ${line}`;
    }
    if (!progOpts.hideNumbers) {
      line = `${i}: ${line}`;
    }
  }

  const terminal = progOpts.compact ? '\t' : '\n';
  const padding  = progOpts.compact ? 0    : getCols() - line.length;

  if (padding >= 0) {
    return `${fn(line)}${' '.repeat(padding)}${terminal}`;
  } else {
    return `${fn(line.slice(0, padding - 3))}${terminal}`;
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
    case 'moveUp':
      return moveSelection(-1);
    case 'moveDown':
      return moveSelection(1);
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

  if (progOpts.compact) {
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
    choices = undefined;
    progResolve = undefined;
    setProgramOptions();
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
  const _selected = Math.min(choices.length - 1, Math.max(0, selected + dir));

  if (selected === _selected) {
    return;
  }

  const rows   = getRows() - 2;
  const height = getHeight();

  // TODO - scolling in COMPACT mode is probably broken
  if (dir < 0 && _selected < rowOffset) {
    rowOffset = _selected;
  } else if (dir > 0 && _selected >= rowOffset + rows) {
    rowOffset = _selected - rows + 1;
  }
  selected = _selected;

  if (progOpts.compact) {
    readline.cursorTo(ttyout, 0);
  }
  readline.moveCursor(ttyout, 0, -height);
  writeScreen(choices, selected, multiSelectedOptions, rowOffset);
}

function moveSelection(dir) {
  const _selected = Math.min(choices.length - 1, Math.max(0, selected + dir));

  if (selected === _selected) {
    return;
  }

  const currentValue = choices[selected];
  choices[selected]  = choices[_selected];
  choices[_selected] = currentValue;
  return moveCursor(dir);
}

function handleSelect(shiftSelect) {
  if (!progOpts.multiline) {
    return handleContinue();
  }

  height = getHeight();

  if (!shiftSelect || lastSelected === selected) {
    const isSelected = !!multiSelectedOptions[selected];
    applySelection(selected, isSelected);
  } else {
    const isSelected    = !multiSelectedOptions[lastSelected];
    const iterDirection = selected > lastSelected ? 1 : -1;
    for (let i = lastSelected; i !== selected; i += iterDirection) {
      applySelection(i, isSelected);
    }
    applySelection(selected, isSelected);
  }

  lastSelected = selected;

  if (progOpts.multiline && progOpts.preserveOrder) {
    let entries = Object.entries(multiSelectedOptions).filter(([key, val]) => !!val);
    entries.sort((a, b) => {
      return a[1] - b[1];
    });
    entries.forEach(([key], index) => {
      multiSelectedOptions[key] = index + 1;
    });
    selectionIndex = entries.length + 1;
  }

  if (progOpts.compact) {
    readline.cursorTo(ttyout, 0);
  }
  readline.moveCursor(ttyout, 0, -height);
  writeScreen(choices, selected, multiSelectedOptions, rowOffset);
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
  if (progOpts.outputIndex) {
    if (progOpts.multiline) {
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
    if (progOpts.multiline) {
      let entries;
      if (progOpts.preserveOrder) {
        entries = [];
        Object.entries(multiSelectedOptions).forEach(([key, value]) => {
          // key is the index of the choice
          // value is the order of selection
          if (!value) return;
          entries[value] = choices[key];
        });
        entries = entries.filter(val => !!val);
      } else {
        entries = choices.filter((_, i) => !!multiSelectedOptions[i]);
      }

      if (CALLED_VIA_CLI) {
        return entries.join('\n');
      } else {
        return entries;
      }
    } else {
      return choices[selected];
    }
  }
}
