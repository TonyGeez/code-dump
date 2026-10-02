# dumpit

Recursively dump a project's files into a single markdown file using fenced code block with the related language tag of the file.
I use alot for pasting a codebase into an LLM or sharing it as one document.

## Install

```bash
npm install -g dumpit
```

Requires Node.js 14.18 or newer.

## Usage

Run it from the root of the project you want to dump:

```bash
dumpit
```

This writes `dump.md` in the current directory.

### Options

| Option | Description |
| --- | --- |
| `-i, --ignore [IGNORE ...]` | Files or directories to ignore (gitignore-style globs supported) |
| `--only [ONLY ...]` | Only include these specific files or directories |
| `-x, --extension [EXT ...]` | Only include files with these extensions |
| `-o, --output OUTPUT` | Output file (default: `dump.md`) |
| `-h, --help` | Show help |

### Examples

```bash
# Only Python and JavaScript files
dumpit -x py js

# Ignore a folder and all log files
dumpit -i node_modules "*.log"

# Only the src folder and one file, written to a custom output
dumpit --only src package.json -o project.md
```

## Ignore files

`dumpit` automatically reads these from the current directory, if they exist:

1. `.gitignore`
2. `.dumpignore`

Both are optional. Patterns from `-i` are applied last. Since the last matching rule wins, a `!pattern` in `.dumpignore` can re-include something that `.gitignore` excluded.

Supported pattern syntax: `*`, `?`, `[abc]`, `**`, a leading `/` (anchor to root), a trailing `/` (directories only), and `!` (negation). The `.git` folder is always skipped.

Example `.dumpignore`:

```
# Don't include lock files or build output in the dump.md file
package-lock.json
dist/
*.min.js
```

## Output format

Each file becomes a section like this, e.g:

````
## src/index.js
```javascript
console.log("hello")
```

## src/cli.js
```javascript
import { program } from 'commander'
...
...
```

## package.json
```json
{
  "name": "my-package",
  "version": "2.0.0",
  "type": "module",
  ...
  ...
}
````
