#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const EXT_TO_LANG = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  mdx: "markdown",
  txt: "text",
  csv: "text",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  tf: "hcl",
  hcl: "hcl",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  scala: "scala",
  vim: "vim",
  dockerfile: "dockerfile",
  makefile: "makefile",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  sol: "solidity",
  vue: "vue",
  svelte: "svelte",
}

// Filenames (no extension, or dotfile patterns) that map to a language
const FILENAME_TO_LANG = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  rakefile: "ruby",
  gemfile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  jenkinsfile: "groovy",
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const toPosix = (p) => p.split(path.sep).join("/")

/** Return the markdown fence language for a given filename. */
function getFenceLang(filename) {
  const base = path.basename(filename.toLowerCase())

  if (hasOwn(FILENAME_TO_LANG, base)) return FILENAME_TO_LANG[base]

  const ext = path.extname(filename).replace(/^\./, "")
  if (ext) {
    const key = ext.toLowerCase()
    return hasOwn(EXT_TO_LANG, key) ? EXT_TO_LANG[key] : ""
  }

  // No extension at all (e.g. .env, .env.local, .gitignore, .dockerignore)
  return "bash"
}

/* ---------- ignore handling (.gitignore-style) ---------- */

/** Read non-empty, non-comment lines from an ignore file, if it exists. */
function readIgnoreFile(directory, name) {
  const file = path.join(directory, name)
  const patterns = []

  try {
    if (!fs.statSync(file).isFile()) return patterns
  } catch {
    return patterns // file doesn't exist: skip silently
  }

  try {
    const text = fs.readFileSync(file, "utf-8")
    for (let line of text.split(/\r?\n/)) {
      line = line.trim()
      if (line && !line.startsWith("#")) patterns.push(line)
    }
  } catch (e) {
    console.log(`Warning: Could not read ${name} file: ${e.message}`)
  }
  return patterns
}

/** Convert a gitignore-style glob to a regex source string. */
function globToRegexSource(glob) {
  let re = ""
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const atSegStart = i === 0 || glob[i - 1] === "/"
        if (atSegStart && glob[i + 2] === "/") {
          re += "(?:.*/)?" // "**/"  -> zero or more directories
          i += 3
          continue
        }
        if (atSegStart && i + 2 >= glob.length) {
          re += ".*" // trailing "/**" -> everything inside
          i += 2
          continue
        }
        re += "[^/]*" // stray "**" behaves like "*"
        i += 2
        continue
      }
      re += "[^/]*"
      i++
    } else if (c === "?") {
      re += "[^/]"
      i++
    } else if (c === "[") {
      const end = glob.indexOf("]", i + 2)
      if (end === -1) {
        re += "\\["
        i++
      } else {
        let cls = glob.slice(i + 1, end)
        if (cls.startsWith("!")) cls = "^" + cls.slice(1)
        re += `[${cls.replace(/\\/g, "\\\\")}]`
        i = end + 1
      }
    } else if (c === "\\" && i + 1 < glob.length) {
      re += glob[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
      i += 2
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
      i++
    }
  }
  return re
}

/** Compile patterns into a matcher: (relPosixPath, isDir) => boolean. */
function buildIgnoreMatcher(patterns) {
  const rules = []
  for (let p of patterns) {
    let negate = false
    if (p.startsWith("!")) {
      negate = true
      p = p.slice(1)
    }
    let dirOnly = false
    if (p.endsWith("/")) {
      dirOnly = true
      p = p.slice(0, -1)
    }
    if (!p) continue

    const anchored = p.includes("/")
    if (p.startsWith("/")) p = p.slice(1)

    const src = globToRegexSource(p)
    const regex = new RegExp(anchored ? `^${src}$` : `^(?:.*/)?${src}$`)
    rules.push({ regex, negate, dirOnly })
  }

  // Last matching rule wins, like git.
  return (relPath, isDir) => {
    let ignored = false
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue
      if (rule.regex.test(relPath)) ignored = !rule.negate
    }
    return ignored
  }
}


function dumpFiles(
  directory = ".",
  outputFile = "dump.md",
  ignoreList = [],
  extensions = null,
  onlyList = null
) {
  if (extensions) {
    extensions = extensions.map((e) => e.toLowerCase().replace(/^\./, ""))
  }
  const only = onlyList ? new Set(onlyList) : null

  // Order: .gitignore (if present), then .dumpignore (if present), then -i args.
  const isIgnored = buildIgnoreMatcher([
    ...readIgnoreFile(directory, ".gitignore"),
    ...readIgnoreFile(directory, ".dumpignore"),
    ...ignoreList,
  ])

  const scriptName = path.basename(fileURLToPath(import.meta.url))
  const fd = fs.openSync(outputFile, "w")

  const walk = (root) => {
    let entries
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      return // mirror os.walk: silently skip unreadable dirs
    }

    let dirs = []
    const files = []
    for (const entry of entries) {
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const st = fs.statSync(path.join(root, entry.name))
          isDir = st.isDirectory()
          isFile = st.isFile()
        } catch {
          continue
        }
      }
      if (isDir)
        dirs.push({ name: entry.name, symlink: entry.isSymbolicLink() })
      else if (isFile) files.push(entry.name)
    }

    // Prune ignored directories (.git is always skipped, as git does)
    dirs = dirs.filter((d) => {
      if (d.name === ".git") return false
      const rel = toPosix(path.relative(directory, path.join(root, d.name)))
      return !isIgnored(rel, true)
    })

    if (only) {
      dirs = dirs.filter((d) => {
        const dirPath = path.relative(directory, path.join(root, d.name))
        if (only.has(d.name) || only.has(dirPath)) return true
        for (const target of only) {
          if (
            target.startsWith(dirPath + path.sep) ||
            target.startsWith(d.name + path.sep)
          ) {
            return true
          }
        }
        return false
      })
    }

    for (const filename of files) {
      const fullPath = path.join(root, filename)
      const relPath = path.relative(directory, fullPath)

      if (isIgnored(toPosix(relPath), false)) continue

      if (only && !only.has(filename) && !only.has(relPath)) continue

      if (filename === scriptName || filename === outputFile) continue

      if (extensions && extensions.length) {
        const ext = path.extname(filename).replace(/^\./, "").toLowerCase()
        if (!extensions.includes(ext)) continue
      }

      const lang = getFenceLang(filename)
      fs.writeSync(fd, `## ${relPath}\n`)
      fs.writeSync(fd, `\`\`\`${lang}\n`)
      try {
        fs.writeSync(fd, fs.readFileSync(fullPath, "utf-8"))
      } catch (e) {
        fs.writeSync(fd, `[Could not read file: ${e.message}]`)
      }
      fs.writeSync(fd, "\n```\n\n")
    }

    // Recurse (os.walk doesn't follow symlinked dirs by default)
    for (const d of dirs) {
      if (!d.symlink) walk(path.join(root, d.name))
    }
  }

  try {
    walk(directory)
  } finally {
    fs.closeSync(fd)
  }
}

/** Minimal argparse-style parser supporting nargs="*" options. */
function parseArgs(argv) {
  const args = { ignore: [], only: null, extension: null, output: "dump.md" }
  const multi = {
    "-i": "ignore",
    "--ignore": "ignore",
    "--only": "only",
    "-x": "extension",
    "--extension": "extension",
  }
  const single = { "-o": "output", "--output": "output" }

  const usage = () => {
    console.log(`usage: dumpit [-h] [-i [IGNORE ...]] [--only [ONLY ...]]
            [-x [EXTENSION ...]] [-o OUTPUT]

Dump files recursively into a markdown file.
Respects .gitignore and .dumpignore in the current directory if present.

options:
  -h, --help            show this help message and exit
  -i, --ignore [IGNORE ...]
                        Files or directories to ignore (default: [])
  --only [ONLY ...]     Only include these specific files or directories
  -x, --extension [EXTENSION ...]
                        Only include files with these extensions (e.g. -x py js txt)
  -o, --output OUTPUT   Output markdown file (default: dump.md)`)
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") {
      usage()
      process.exit(0)
    } else if (hasOwn(multi, arg)) {
      const key = multi[arg]
      const values = []
      while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        values.push(argv[++i])
      }
      args[key] = (args[key] ?? []).concat(values)
    } else if (hasOwn(single, arg)) {
      if (i + 1 >= argv.length) {
        console.error(`error: argument ${arg}: expected one argument`)
        process.exit(2)
      }
      args[single[arg]] = argv[++i]
    } else {
      console.error(`error: unrecognized arguments: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
dumpFiles(".", args.output, args.ignore, args.extension, args.only)
