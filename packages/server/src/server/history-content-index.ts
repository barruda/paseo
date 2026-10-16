import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { HistoryQuery, HistoryQueryTerm } from "@getpaseo/protocol/search/history-query";

// CUSTOM(history-content-search): a full-text index of what was said in each session, so
// History search finds sessions by their messages and not only by their names.

type SqliteValue = string | number | null;

interface SqliteStatement {
  run(...params: SqliteValue[]): { changes: number | bigint };
  all(...params: SqliteValue[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

// The daemon runs on Node 24, which ships node:sqlite with FTS5, but the server's @types/node
// predates it. Requiring it on open keeps the types local and a load failure catchable.
function openSqlite(dbPath: string): SqliteDatabase {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  return new DatabaseSync(dbPath);
}

export type HistoryMessageRole = "user" | "assistant";

export interface HistoryMessage {
  role: HistoryMessageRole;
  text: string;
  timestamp?: string;
}

export interface HistoryContentMatch {
  /** A short excerpt of the best matching message, whitespace collapsed. */
  text: string;
  /** Spans of `text` that matched the query, in order and non-overlapping. */
  ranges: { start: number; length: number }[];
  role: HistoryMessageRole;
}

export interface HistoryContentSearchResult {
  /** The best message per session that satisfies every required term on its own. */
  matches: Map<string, HistoryContentMatch>;
  /** Sessions with any message that mentions an excluded term. */
  excludedAgentIds: Set<string>;
}

const SNIPPET_TOKENS = 16;
const MAX_SEARCH_ROWS = 20_000;
const MARK_START = "\u0001";
const MARK_END = "\u0002";

/**
 * Messages live in a plain table keyed by (agent, content hash), so indexing the same
 * conversation again — every turn, after a restart, or from both the live timeline and the
 * provider's transcript file — never stores a message twice. The FTS table mirrors it.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ts TEXT,
  hash TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (agent_id, hash)
);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content = 'messages',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TABLE IF NOT EXISTS backfilled_agents (
  agent_id TEXT PRIMARY KEY,
  backfilled_at TEXT NOT NULL
);
`;

export class HistoryContentIndex {
  private readonly db: SqliteDatabase;
  private readonly insertMessage: SqliteStatement;
  private readonly searchMessages: SqliteStatement;
  private readonly searchAgentIds: SqliteStatement;
  private readonly selectBackfilled: SqliteStatement;
  private readonly insertBackfilled: SqliteStatement;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = openSqlite(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    this.insertMessage = this.db.prepare(
      "INSERT OR IGNORE INTO messages (agent_id, role, ts, hash, text) VALUES (?, ?, ?, ?, ?)",
    );
    this.searchMessages = this.db.prepare(
      `SELECT m.agent_id AS agentId, m.role AS role,
         snippet(messages_fts, 0, char(1), char(2), '…', ${SNIPPET_TOKENS}) AS snippet
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ${MAX_SEARCH_ROWS}`,
    );
    this.searchAgentIds = this.db.prepare(
      `SELECT DISTINCT m.agent_id AS agentId
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ?`,
    );
    this.selectBackfilled = this.db.prepare("SELECT agent_id AS agentId FROM backfilled_agents");
    this.insertBackfilled = this.db.prepare(
      "INSERT OR REPLACE INTO backfilled_agents (agent_id, backfilled_at) VALUES (?, ?)",
    );
  }

  /** Adds messages not indexed yet. Returns how many were new. */
  addMessages(agentId: string, messages: readonly HistoryMessage[]): number {
    let added = 0;
    this.db.exec("BEGIN");
    try {
      for (const message of messages) {
        const text = message.text.trim();
        if (!text) continue;
        const hash = createHash("sha1")
          .update(message.role)
          .update("\0")
          .update(text)
          .digest("hex");
        const result = this.insertMessage.run(
          agentId,
          message.role,
          message.timestamp ?? null,
          hash,
          text,
        );
        added += Number(result.changes);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return added;
  }

  /**
   * Required terms must all appear in one message, so the excerpt shows them together.
   * Exclusions apply to the whole session: one message mentioning the term drops it.
   */
  search(query: HistoryQuery): HistoryContentSearchResult {
    const matches = new Map<string, HistoryContentMatch>();
    const excludedAgentIds = new Set<string>();
    const excludedExpression = toFtsExpression([query.excluded]);
    if (excludedExpression) {
      const rows = this.searchAgentIds.all(excludedExpression) as { agentId: string }[];
      for (const row of rows) excludedAgentIds.add(row.agentId);
    }
    const expression = toFtsExpression(query.required);
    if (!expression) return { matches, excludedAgentIds };
    const rows = this.searchMessages.all(expression) as {
      agentId: string;
      role: HistoryMessageRole;
      snippet: string;
    }[];
    for (const row of rows) {
      if (matches.has(row.agentId) || excludedAgentIds.has(row.agentId)) continue;
      matches.set(row.agentId, { ...parseSnippet(row.snippet), role: row.role });
    }
    return { matches, excludedAgentIds };
  }

  backfilledAgentIds(): Set<string> {
    const rows = this.selectBackfilled.all() as { agentId: string }[];
    return new Set(rows.map((row) => row.agentId));
  }

  markBackfilled(agentId: string): void {
    this.insertBackfilled.run(agentId, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}

/**
 * User input never reaches FTS syntax: each term becomes a quoted phrase of its words, which hold
 * only letters and digits, so no quote or operator survives. Unquoted terms get a prefix `*`.
 */
function toFtsTerm(term: HistoryQueryTerm): string {
  const phrase = `"${term.words.join(" ")}"`;
  return term.exact ? phrase : `${phrase}*`;
}

/** Groups are ANDed, the terms inside a group ORed. Null when there is nothing to match. */
export function toFtsExpression(groups: readonly (readonly HistoryQueryTerm[])[]): string | null {
  const parts = groups
    .filter((group) => group.length > 0)
    .map((group) => {
      const alternatives = group.map(toFtsTerm);
      return alternatives.length === 1 ? alternatives[0] : `(${alternatives.join(" OR ")})`;
    });
  return parts.length > 0 ? parts.join(" AND ") : null;
}

export function parseSnippet(snippet: string): Pick<HistoryContentMatch, "text" | "ranges"> {
  const collapsed = snippet.replace(/\s+/g, " ").trim();
  const ranges: HistoryContentMatch["ranges"] = [];
  let text = "";
  let markStart: number | null = null;
  for (const char of collapsed) {
    if (char === MARK_START) {
      markStart = text.length;
    } else if (char === MARK_END) {
      if (markStart !== null && text.length > markStart) {
        ranges.push({ start: markStart, length: text.length - markStart });
      }
      markStart = null;
    } else {
      text += char;
    }
  }
  return { text, ranges };
}

let activeIndex: HistoryContentIndex | null = null;

/** The daemon's index, or null when it is not running (tests, failed open). */
export function getActiveHistoryContentIndex(): HistoryContentIndex | null {
  return activeIndex;
}

export function setActiveHistoryContentIndex(index: HistoryContentIndex | null): void {
  activeIndex = index;
}
