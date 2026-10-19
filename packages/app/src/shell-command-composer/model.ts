// CUSTOM(shell-command-composer): history and Tab completion for `!<command>` lines, which the
// composer routes to the shell-command plugin. Pure; the hook wires it to the composer.

const MAX_HISTORY_MATCHES = 30;

/** Where the command starts in a one-line `!` composer text, or null when it isn't one. */
export function shellCommandOffset(text: string): number | null {
  if (text.includes("\n")) return null;
  const match = /^\s*!\s*/.exec(text);
  return match ? match[0].length : null;
}

export interface ShellWord {
  start: number;
  end: number;
  text: string;
  /** True when the word is the command name (nothing but spaces before it). */
  isCommand: boolean;
}

/** The word the cursor ends: back from the cursor to an unescaped space or the command start. */
export function findShellWord(text: string, cursor: number, offset: number): ShellWord {
  let start = cursor;
  while (start > offset) {
    const previous = text[start - 1]!;
    if (/\s/.test(previous) && text[start - 2] !== "\\") break;
    start -= 1;
  }
  return {
    start,
    end: cursor,
    text: text.slice(start, cursor),
    isCommand: text.slice(offset, start).trim().length === 0,
  };
}

/** Past commands that extend what is typed after `!`, newest first. */
export function matchHistory(history: readonly string[], typed: string): string[] {
  const prefix = typed.trimStart();
  return history
    .filter((entry) => entry.startsWith(prefix) && entry !== prefix)
    .slice(0, MAX_HISTORY_MATCHES);
}

export type ShellCompletion =
  | { type: "history"; command: string }
  | { type: "path"; value: string; kind: "file" | "directory"; word: ShellWord };

/**
 * History completes the whole line, so it only applies with the cursor at the end. Paths complete
 * the word under the cursor; an empty command word lists history only, since every file in the
 * folder is rarely the command you want.
 */
export function buildShellCompletions(input: {
  text: string;
  cursor: number;
  history: readonly string[];
  paths: readonly { value: string; kind: "file" | "directory" }[];
}): ShellCompletion[] {
  const offset = shellCommandOffset(input.text);
  if (offset === null) return [];
  const cursor = Math.max(offset, Math.min(input.cursor, input.text.length));
  const completions: ShellCompletion[] = [];
  if (cursor === input.text.length) {
    for (const command of matchHistory(input.history, input.text.slice(offset))) {
      completions.push({ type: "history", command });
    }
  }
  const word = findShellWord(input.text, cursor, offset);
  if (wantsPaths(word)) {
    for (const path of input.paths) {
      if (path.value.startsWith(word.text) && path.value !== word.text) {
        completions.push({ type: "path", value: path.value, kind: path.kind, word });
      }
    }
  }
  return completions;
}

export function wantsPaths(word: ShellWord): boolean {
  return !word.isCommand || word.text.length > 0;
}

/** The composer text after picking a completion. A file gets a trailing space, like a shell. */
export function applyShellCompletion(text: string, completion: ShellCompletion): string {
  if (completion.type === "history") {
    const offset = shellCommandOffset(text) ?? 0;
    return `${text.slice(0, offset)}${completion.command}`;
  }
  const { start, end } = completion.word;
  const after = text.slice(end);
  const suffix = completion.kind === "file" && !/^\s/.test(after) ? " " : "";
  return `${text.slice(0, start)}${completion.value}${suffix}${after}`;
}

export interface HistoryNavigation {
  /** What was typed after `!` when navigation started; entries must start with it. */
  prefix: string;
  /** Index into history of the entry shown, or -1 for the original text. */
  index: number;
  original: string;
  /** The text navigation last set. Any other text means the user edited it: start over. */
  shown: string;
}

/**
 * Up and Down walk the history entries that start with what was typed, like zsh's
 * history-beginning-search. Down past the newest entry restores the typed text. Returns null when
 * the key does nothing, so the composer handles it.
 */
export function stepHistory(input: {
  navigation: HistoryNavigation | null;
  history: readonly string[];
  text: string;
  direction: "up" | "down";
}): { navigation: HistoryNavigation | null; text: string } | null {
  const offset = shellCommandOffset(input.text);
  if (offset === null) return null;
  const navigation =
    input.navigation && input.navigation.shown === input.text
      ? input.navigation
      : {
          prefix: input.text.slice(offset).trimStart(),
          index: -1,
          original: input.text,
          shown: input.text,
        };
  const matches = (entry: string) =>
    entry.startsWith(navigation.prefix) && entry !== navigation.prefix;
  const head = input.text.slice(0, offset);

  if (input.direction === "up") {
    const index = input.history.findIndex((entry, i) => i > navigation.index && matches(entry));
    if (index < 0) return navigation.index < 0 ? null : { navigation, text: input.text };
    const text = `${head}${input.history[index]}`;
    return { navigation: { ...navigation, index, shown: text }, text };
  }

  if (navigation.index < 0) return null;
  let index = navigation.index - 1;
  while (index >= 0 && !matches(input.history[index]!)) index -= 1;
  if (index < 0) return { navigation: null, text: navigation.original };
  const text = `${head}${input.history[index]}`;
  return { navigation: { ...navigation, index, shown: text }, text };
}
