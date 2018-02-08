# seline

Tool for interactively selecting input lines

![Gif showing seline in use](https://thumbs.gfycat.com/LatePiercingBedbug-size_restricted.gif)

> **se**(lect) **line**(s)

`seline` is a command line tool for interactively selecting one (or more) lines from `stdin` and passing them to `stdout`.  It is intended to be composed with other tools.

## Installation

Via npm

```bash
npm install -g seline
```

Via yarn

```bash
yarn global add seline
```

## CLI Examples

Here are some example applications that I have been using

### Select and delete multiple git branches

```bash
$ git branch | seline -m | xargs git branch -D
```

### Checking out a recent git branch.

```bash
$ git branch --sort=-committerdate | grep -v '*' | seline | xargs git checkout
```

### Select a branch, then select commits to cherry-pick

```bash
git branch | seline | xargs git log --oneline | seline -m | awk '{print $1}' | tail -r | xargs git cherry-pick
```

## Programmatic Examples

`seline` can also be required and used programmatically.  Results are returned as a promise.

> `seline(choices, options)`

* `choices` required; an array of strings that are presented for selection
* `options` optional; a dict of configuration options

option | type | default | description
---|---|---|---
`multiline` | _boolean_ | `false` | enable multiple line selection 
`outputIndex` | _boolean_ | `false` | output line index instead of line
`hideNumbers` | _boolean_ | `false` | hide selection number prefix
`preserveOrder` | _boolean_ | `false` | output lines in order of selection
`compact` | _boolean_ | `false` | separate options by tabs instead of newlines
`skipBlanks` | _boolean_ | `false` | selection cursor skips empty lines
`skipChar` | _char_ | `null` | selection cursor skips line starting with _char_
`noColor` | _boolean_ | `false` | use extra characters to show state instead of color
`lockLines` | _boolean_ | `false` | prevent reordering lines with `u` and `d`

```javascript
const seline = require('seline');

async function main() {
  const results = await seline(['a', 'b', 'c'], { multiline: true });
}
```
