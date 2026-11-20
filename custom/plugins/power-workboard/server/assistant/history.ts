// CUSTOM(projects-assistant): append-only history of the Project Manager, one JSON object per
// line in one file per local day (`YYYY-MM-DD.jsonl`), kept HISTORY_RETENTION_DAYS days.
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import {
  HISTORY_RETENTION_DAYS,
  historyEventSchema,
  type HistoryEvent,
  type HistoryEventKind,
} from "../../shared/assistant";

export type HistoryEventInput = Omit<
  HistoryEvent,
  "id" | "at" | "reason" | "detail" | "by"
> & {
  at?: string;
  reason?: HistoryEvent["reason"];
  detail?: HistoryEvent["detail"];
  by?: HistoryEvent["by"]; // CUSTOM(assistant-cards)
};

export interface HistoryQuery {
  cursor: string | null;
  limit: number;
  projectId: string | null;
  orchestratorId: string | null;
  taskId: string | null;
  kinds: HistoryEventKind[];
  from: string | null;
  to: string | null;
}

/** `<PASEO_HOME>/plugin-data/power-workboard/history`, next to the image folder. */
export function defaultHistoryDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.join(
    path.resolve(home),
    "plugin-data",
    "power-workboard",
    "history",
  );
}

const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Local calendar day, `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function time(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

/** Newest first: later `at`, then larger id. */
export function newestFirst(
  left: { at: string; id: string },
  right: { at: string; id: string },
): number {
  return (
    time(right.at) - time(left.at) ||
    (right.id < left.id ? -1 : right.id > left.id ? 1 : 0)
  );
}

function encodeCursor(event: HistoryEvent): string {
  return Buffer.from(JSON.stringify({ at: event.at, id: event.id })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      at?: unknown;
      id?: unknown;
    };
    return typeof value.at === "string" && typeof value.id === "string"
      ? { at: value.at, id: value.id }
      : null;
  } catch {
    return null;
  }
}

/**
 * CUSTOM(assistant-reports): one JSON object per line, one file per local day, pruned after the
 * retention. The history and the assistant's reports (`reports.ts`) both live in one of these.
 */
export class DayJsonlStore<T extends { id: string; at: string }> {
  private chain: Promise<unknown> = Promise.resolve();
  /**
   * Parsed day files by name, reused while the file's mtime and size are unchanged. The Reports
   * page polls every file every few seconds; only the day being written changes.
   */
  private readonly cache = new Map<
    string,
    { mtimeMs: number; size: number; values: readonly T[] }
  >();

  constructor(
    readonly directory: string,
    private readonly schema: z.ZodType<T>,
    readonly options: { now?: () => Date; retentionDays?: number } = {},
  ) {}

  protected now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  /** Validates `value`, writes it as one line of its day's file, returns the stored value. */
  protected async write(value: unknown): Promise<T> {
    const stored = this.schema.parse(value);
    const day = localDay(new Date(stored.at));
    const write = async () => {
      await mkdir(this.directory, { recursive: true });
      await appendFile(
        path.join(this.directory, `${day}.jsonl`),
        `${JSON.stringify(stored)}\n`,
      );
    };
    const result = this.chain.then(write, write);
    this.chain = result.catch(() => undefined);
    await result;
    return stored;
  }

  protected async files(): Promise<string[]> {
    try {
      return (await readdir(this.directory))
        .filter((name) => FILE_PATTERN.test(name))
        .sort();
    } catch {
      return [];
    }
  }

  /** The file's values in file order. Shared with the cache: callers must not mutate it. */
  protected async readFile(name: string): Promise<readonly T[]> {
    const file = path.join(this.directory, name);
    let text: string;
    let info: { mtimeMs: number; size: number };
    try {
      info = await stat(file);
      const cached = this.cache.get(name);
      if (
        cached &&
        cached.mtimeMs === info.mtimeMs &&
        cached.size === info.size
      )
        return cached.values;
      text = await readFile(file, "utf8");
    } catch {
      this.cache.delete(name);
      return [];
    }
    const values: T[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = this.schema.safeParse(JSON.parse(line));
        if (parsed.success) values.push(parsed.data);
      } catch {
        // Skip a malformed line.
      }
    }
    // The size read with the text: an append between stat and read is picked up next time.
    this.cache.set(name, {
      mtimeMs: info.mtimeMs,
      size: Buffer.byteLength(text),
      values,
    });
    return values;
  }

  /**
   * Every value at or after `fromIso` (all of them when null) that passes `filter`, oldest first.
   */
  async since(
    fromIso: string | null,
    filter?: (value: T) => boolean,
  ): Promise<T[]> {
    const from = fromIso === null ? null : time(fromIso);
    const fromDay = from === null ? null : localDay(new Date(from));
    const values: T[] = [];
    for (const name of await this.files()) {
      if (fromDay !== null && name.slice(0, 10) < fromDay) continue;
      values.push(
        ...(await this.readFile(name)).filter(
          (value) =>
            (from === null || time(value.at) >= from) &&
            (!filter || filter(value)),
        ),
      );
    }
    return values.sort((left, right) => -newestFirst(left, right));
  }

  /** Deletes day files older than the retention. */
  async prune(): Promise<void> {
    const days = this.options.retentionDays ?? HISTORY_RETENTION_DAYS;
    const limit = new Date(this.now());
    limit.setHours(12, 0, 0, 0);
    limit.setDate(limit.getDate() - days);
    const oldest = localDay(limit);
    for (const name of await this.files()) {
      if (name.slice(0, 10) < oldest) {
        this.cache.delete(name);
        await unlink(path.join(this.directory, name)).catch(() => {});
      }
    }
  }
}

export class HistoryStore extends DayJsonlStore<HistoryEvent> {
  constructor(
    directory: string,
    options: { now?: () => Date; retentionDays?: number } = {},
  ) {
    super(directory, historyEventSchema, options);
  }

  /** Assigns `id` and `at` (unless given), writes one line, returns the stored event. */
  append(event: HistoryEventInput): Promise<HistoryEvent> {
    return this.write({
      ...event,
      id: randomUUID(),
      at: event.at ?? this.now().toISOString(),
    });
  }

  /** Newest first, filtered; `nextCursor` is null on the last page. */
  async list(
    query: HistoryQuery,
  ): Promise<{ events: HistoryEvent[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.floor(query.limit));
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const cursorEvent = cursor
      ? ({ at: cursor.at, id: cursor.id } as HistoryEvent)
      : null;
    const from = query.from === null ? null : time(query.from);
    const to = query.to === null ? null : time(query.to);
    const fromDay = query.from === null ? null : localDay(new Date(from!));
    const toDay = query.to === null ? null : localDay(new Date(to!));
    const cursorDay = cursor ? localDay(new Date(time(cursor.at))) : null;
    const kinds = new Set(query.kinds);
    const matches = (event: HistoryEvent) => {
      if (query.projectId !== null && event.projectId !== query.projectId)
        return false;
      if (
        query.orchestratorId !== null &&
        event.orchestratorId !== query.orchestratorId
      )
        return false;
      if (query.taskId !== null && event.taskId !== query.taskId) return false;
      if (kinds.size && !kinds.has(event.kind)) return false;
      const at = time(event.at);
      if (from !== null && at < from) return false;
      if (to !== null && at > to) return false;
      if (cursorEvent && newestFirst(cursorEvent, event) >= 0) return false;
      return true;
    };
    const collected: HistoryEvent[] = [];
    for (const name of (await this.files()).reverse()) {
      const day = name.slice(0, 10);
      if (fromDay !== null && day < fromDay) break;
      if (toDay !== null && day > toDay) continue;
      if (cursorDay !== null && day > cursorDay) continue;
      collected.push(
        ...(await this.readFile(name)).filter(matches).sort(newestFirst),
      );
      if (collected.length > limit) break;
    }
    const events = collected.slice(0, limit);
    return {
      events,
      nextCursor:
        collected.length > limit
          ? encodeCursor(events[events.length - 1])
          : null,
    };
  }
}
