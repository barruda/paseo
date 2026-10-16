// CUSTOM(history-content-search): the operators History search understands, parsed once so
// the daemon (name and message matching) and the app (highlighting) read a query the same way.
//
//   relay socket      both words, each as a word prefix
//   "at once"         the exact words, adjacent and in order; quoted words are whole words
//   relay OR socket   either one (also `|`); binds tighter than the implicit AND
//   -relay -"at once" leave out every session that mentions it anywhere

export interface HistoryQueryTerm {
  /** The term as typed, without quotes or a leading `-`. Name matching scores this. */
  text: string;
  /** Lowercase letter-and-digit runs, accents removed, as the FTS tokenizer splits them. */
  words: string[];
  /** Quoted: every word is a whole word. Unquoted: the last word may be a prefix. */
  exact: boolean;
}

export interface HistoryQuery {
  /** Every group must match; a group matches when any one of its terms does. */
  required: HistoryQueryTerm[][];
  /** A session that matches any of these is left out. */
  excluded: HistoryQueryTerm[];
}

type QueryToken = { kind: "or" } | { kind: "term"; term: HistoryQueryTerm; negated: boolean };

export function historyQueryWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

function tokenize(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let index = 0;
  while (index < query.length) {
    if (/\s/u.test(query[index])) {
      index += 1;
      continue;
    }
    let negated = false;
    if (query[index] === "-" && index + 1 < query.length && !/\s/u.test(query[index + 1])) {
      negated = true;
      index += 1;
    }
    let text: string;
    let exact: boolean;
    if (query[index] === '"') {
      const close = query.indexOf('"', index + 1);
      const end = close === -1 ? query.length : close;
      text = query.slice(index + 1, end);
      // Still typing the phrase: let its last word stay a prefix until the quote closes.
      exact = close !== -1;
      index = end + 1;
    } else {
      const start = index;
      while (index < query.length && !/\s/u.test(query[index]) && query[index] !== '"') {
        index += 1;
      }
      text = query.slice(start, index);
      exact = false;
      if (!negated && (text === "OR" || text === "|")) {
        tokens.push({ kind: "or" });
        continue;
      }
    }
    const words = historyQueryWords(text);
    if (words.length > 0) {
      tokens.push({ kind: "term", term: { text: text.trim(), words, exact }, negated });
    }
  }
  return tokens;
}

export function parseHistoryQuery(query: string): HistoryQuery {
  const required: HistoryQueryTerm[][] = [];
  const excluded: HistoryQueryTerm[] = [];
  let joinNext = false;
  let previousWasRequired = false;
  for (const token of tokenize(query)) {
    if (token.kind === "or") {
      joinNext = previousWasRequired;
      continue;
    }
    if (token.negated) {
      excluded.push(token.term);
      joinNext = false;
      previousWasRequired = false;
      continue;
    }
    const lastGroup = required.at(-1);
    if (joinNext && lastGroup) {
      lastGroup.push(token.term);
    } else {
      required.push([token.term]);
    }
    joinNext = false;
    previousWasRequired = true;
  }
  return { required, excluded };
}

/** The words worth marking in a row: what the query asks for, never what it excludes. */
export function historyQueryHighlightText(query: string): string {
  return parseHistoryQuery(query)
    .required.flat()
    .flatMap((term) => (term.exact ? term.words : [term.text]))
    .join(" ");
}

/**
 * Whether `text` contains the term the way the message index matches it: its words adjacent
 * and in order, each a whole word except an unquoted term's last word, which may be a prefix.
 */
export function textContainsHistoryTerm(text: string, term: HistoryQueryTerm): boolean {
  const words = historyQueryWords(text);
  const last = term.words.length - 1;
  for (let start = 0; start + last < words.length; start += 1) {
    const matches = term.words.every((word, offset) => {
      const candidate = words[start + offset];
      return offset === last && !term.exact ? candidate.startsWith(word) : candidate === word;
    });
    if (matches) return true;
  }
  return false;
}
