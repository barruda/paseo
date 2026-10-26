// CUSTOM(shell-output-files): agents often send a command's output to a file and read back only
// part of it (`cmd > $S/out.txt; head -150 $S/out.txt`), so the chat shows a fraction of the log.
// This finds the files a shell command writes with a redirect or `tee`, or reads with `cat`,
// `head`, `tail`, `less` or `more`, so the tool call can link to them. Variables assigned in the
// same command (`S=/tmp/x; ... $S/out.txt`) are expanded; anything that depends on what the shell
// computes at run time (`$(...)`, unknown variables, globs, `~`) is left out rather than guessed.

const READERS = new Set(["cat", "head", "tail", "less", "more"]);
/** Reader flags that take a value as the next word (`head -n 150`). */
const READER_VALUE_FLAGS = new Set(["-n", "-c", "--lines", "--bytes"]);
const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "for",
  "!",
  "{",
  "}",
  "(",
  ")",
  "time",
  "exec",
]);
const IGNORED_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

type Token =
  | { kind: "word"; raw: string; quoted: boolean }
  | { kind: "separator" }
  | { kind: "pipe" }
  | { kind: "redirect"; op: string };

const OPERATOR = /^(&>>|&>|\d*>>|\d*>&|\d*>\||\d*>|<<<|<<-|<<|<|&&|\|\||\||;;|;|&|\n|\(|\))/;

function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let heredocs: string[] = [];
  const skipHeredocs = () => {
    // The heredoc bodies start on the line after the one that opened them.
    for (const delimiter of heredocs) {
      while (index < command.length) {
        const end = command.indexOf("\n", index);
        const line = command.slice(index, end < 0 ? command.length : end);
        index = end < 0 ? command.length : end + 1;
        if (line.trim() === delimiter) break;
      }
    }
    heredocs = [];
  };
  while (index < command.length) {
    const char = command[index];
    if (char === " " || char === "\t" || (char === "\\" && command[index + 1] === "\n")) {
      index += char === "\\" ? 2 : 1;
      continue;
    }
    if (char === "#") {
      const end = command.indexOf("\n", index);
      index = end < 0 ? command.length : end;
      continue;
    }
    const operator = command.slice(index).match(OPERATOR)?.[0];
    if (operator) {
      index += operator.length;
      if (operator === "\n") {
        tokens.push({ kind: "separator" });
        skipHeredocs();
      } else if (operator === "|") {
        tokens.push({ kind: "pipe" });
      } else if (/^(&&|\|\||;;|;|&|\(|\))$/.test(operator)) {
        tokens.push({ kind: "separator" });
      } else {
        tokens.push({ kind: "redirect", op: operator });
        if (operator.startsWith("<<") && operator !== "<<<") {
          const word = readWord(command, skipBlanks(command, index));
          index = word.end;
          heredocs.push(word.value.replace(/["']/g, ""));
        }
      }
      continue;
    }
    const word = readWord(command, index);
    index = Math.max(word.end, index + 1);
    tokens.push({ kind: "word", raw: word.value, quoted: word.quoted });
  }
  return tokens;
}

function skipBlanks(text: string, index: number): number {
  let at = index;
  while (text[at] === " " || text[at] === "\t") at += 1;
  return at;
}

/** Reads one shell word, keeping quotes and `$(...)` inside it as written. */
function readWord(text: string, start: number): { value: string; end: number; quoted: boolean } {
  let index = start;
  let quoted = false;
  while (index < text.length) {
    const char = text[index];
    if (char === "'" || char === '"') {
      quoted = true;
      const close = closingQuote(text, index);
      index = close < 0 ? text.length : close + 1;
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "$" && (text[index + 1] === "(" || text[index + 1] === "{")) {
      index = closingBracket(text, index + 1) + 1;
      continue;
    }
    if (/[\s;&|<>()]/.test(char)) break;
    index += 1;
  }
  return { value: text.slice(start, Math.min(index, text.length)), end: index, quoted };
}

function closingQuote(text: string, open: number): number {
  const quote = text[open];
  for (let index = open + 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === "\\") {
      index += 1;
    } else if (text[index] === quote) {
      return index;
    }
  }
  return -1;
}

function closingBracket(text: string, open: number): number {
  const opener = text[open];
  const closer = opener === "(" ? ")" : "}";
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" || char === '"') {
      const close = closingQuote(text, index);
      if (close < 0) return text.length;
      index = close;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

/**
 * Expands a word with the variables known so far. Returns null when the value depends on
 * something only the running shell knows.
 */
function expandWord(raw: string, vars: ReadonlyMap<string, string | null>): string | null {
  if (raw.includes("$(") || raw.includes("`") || raw.startsWith("~")) return null;
  let out = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  while (index < raw.length) {
    const char = raw[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else out += char;
      index += 1;
      continue;
    }
    if (char === "'" && !quote) {
      quote = "'";
      index += 1;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? null : '"';
      index += 1;
      continue;
    }
    if (char === "\\") {
      out += raw[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === "$") {
      const match = raw
        .slice(index)
        .match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/);
      if (!match) return null;
      const value = vars.get(match[1] ?? match[2]);
      if (value === undefined || value === null) return null;
      out += value;
      index += match[0].length;
      continue;
    }
    if (!quote && /[*?[\]{}]/.test(char)) return null;
    out += char;
    index += 1;
  }
  return out;
}

function joinPath(directory: string, path: string): string {
  const parts: string[] = [];
  for (const part of `${directory}/${path}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** An absolute path for `value`, or null when it is relative and the directory is unknown. */
function resolvePath(value: string, directory: string | null): string | null {
  if (value.startsWith("/")) return joinPath("/", value);
  return directory ? joinPath(directory, value) : null;
}

export function shellOutputFiles(command: string, cwd?: string): string[] {
  const vars = new Map<string, string | null>();
  const files: string[] = [];
  let directory = cwd?.startsWith("/") ? cwd : null;
  const add = (raw: string) => {
    const value = expandWord(raw, vars);
    if (!value || value === "-" || IGNORED_TARGETS.has(value)) return;
    const path = resolvePath(value, directory);
    if (path && !files.includes(path)) files.push(path);
  };

  let words: string[] = [];
  let pendingRedirect: string | null = null;
  const finishCommand = () => {
    const name = words[0];
    const args = words.slice(1);
    if (name === "cd" && args.length === 1) {
      const target = expandWord(args[0], vars);
      directory = target ? resolvePath(target, directory) : null;
    } else if (name === "tee") {
      for (const arg of args) if (!arg.startsWith("-")) add(arg);
    } else if (name && READERS.has(name)) {
      for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (READER_VALUE_FLAGS.has(arg)) index += 1;
        else if (!arg.startsWith("-") && !arg.startsWith("+")) add(arg);
      }
    }
    words = [];
  };

  for (const token of tokenize(command)) {
    if (token.kind === "redirect") {
      pendingRedirect = token.op;
      continue;
    }
    if (token.kind !== "word") {
      pendingRedirect = null;
      finishCommand();
      continue;
    }
    if (pendingRedirect) {
      const op = pendingRedirect;
      pendingRedirect = null;
      // `2>&1` and `>&2` duplicate a descriptor; `<` and here-strings read input.
      if (op.includes(">") && !op.endsWith(">&")) add(token.raw);
      continue;
    }
    if (words.length === 0 && !token.quoted && KEYWORDS.has(token.raw)) continue;
    const assignment = words.length === 0 && token.raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
    if (assignment) {
      vars.set(assignment[1], expandWord(assignment[2], vars));
      continue;
    }
    words.push(token.raw);
  }
  finishCommand();
  return files;
}
