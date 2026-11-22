// CUSTOM(task-records-jsonl): task attempts and orchestrator logs live in append-only JSONL files,
// `<PASEO_HOME>/plugin-data/power-workboard/attempts/YYYY-MM-DD.jsonl` and
// `orchestrator-logs/<orchestratorId>.jsonl`, instead of the board's JSON. The Store
// (server/store.ts) keeps the recent part in memory and decides what is appended.
import { mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { attemptSchema, type Attempt } from "../shared/assistant";
import {
  orchestratorLogEntrySchema,
  type OrchestratorLogEntry,
} from "../shared/model";

/**
 * One line of an attempts file. `attempt` replaces the task's attempt with the same index (or adds
 * it); `reset` clears the task's list, and the attempts it still has follow it.
 */
export type AttemptRecord =
  | { taskId: string; attempt: Attempt }
  | { taskId: string; reset: true };

const attemptLine = z.union([
  z.object({ at: z.string(), taskId: z.string(), attempt: attemptSchema }),
  z.object({ at: z.string(), taskId: z.string(), reset: z.literal(true) }),
]);

/** Where the Store keeps attempts and orchestrator logs. */
export interface RecordFiles {
  /**
   * Every task's attempts, folded from all the files, oldest first. Throws when a file cannot be
   * read: a partial fold would let a new attempt overwrite an older one with the same index. A
   * line that does not parse (a write cut by a crash) is skipped.
   */
  readAttempts(): Promise<Record<string, Attempt[]>>;
  /** Appends to the current day's file; the data is on disk when this resolves. */
  appendAttempts(records: readonly AttemptRecord[]): Promise<void>;
  /**
   * The last `limit` entries of each orchestrator's log, oldest first. An orchestrator with no
   * file, or a file that cannot be read (logged), is left out.
   */
  readLogs(
    orchestratorIds: readonly string[],
    limit: number,
  ): Promise<Record<string, OrchestratorLogEntry[]>>;
  appendLogs(
    orchestratorId: string,
    entries: readonly OrchestratorLogEntry[],
  ): Promise<void>;
  removeLogs(orchestratorId: string): Promise<void>;
}

function paseoHome(env: NodeJS.ProcessEnv): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  return path.resolve(
    raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw,
  );
}

/** The folder that holds `attempts/` and `orchestrator-logs/`. */
export function defaultRecordDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(paseoHome(env), "plugin-data", "power-workboard");
}

/** The copy of the board's JSON taken before attempts and logs first move out of it. */
export function preRecordsBackupFile(settingsFile: string): string {
  return path.join(
    path.dirname(settingsFile),
    "workboard-data.pre-records.json",
  );
}

/** Orchestrator ids become file names, so anything that could leave the folder is refused. */
function logFileName(orchestratorId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(orchestratorId))
    throw new Error(
      `Invalid orchestrator id for a log file: ${orchestratorId}`,
    );
  return `${orchestratorId}.jsonl`;
}

/** Folds attempt records, in file order, into each task's list sorted by index. */
export function foldAttempts(
  records: Iterable<AttemptRecord>,
): Record<string, Attempt[]> {
  const byTask = new Map<string, Map<number, Attempt>>();
  for (const record of records) {
    if ("reset" in record) {
      byTask.delete(record.taskId);
      continue;
    }
    const list = byTask.get(record.taskId) ?? new Map<number, Attempt>();
    list.set(record.attempt.index, record.attempt);
    byTask.set(record.taskId, list);
  }
  const folded: Record<string, Attempt[]> = {};
  for (const [taskId, list] of byTask)
    if (list.size)
      folded[taskId] = [...list.values()].sort((a, b) => a.index - b.index);
  return folded;
}

/** The records that turn `before` (what the files hold) into `after`. */
export function attemptRecords(
  before: Readonly<Record<string, readonly Attempt[]>>,
  after: Readonly<Record<string, readonly Attempt[]>>,
): AttemptRecord[] {
  const records: AttemptRecord[] = [];
  for (const taskId of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const old = before[taskId] ?? [];
    const next = after[taskId] ?? [];
    const kept = new Set(next.map((attempt) => attempt.index));
    const reset = old.some((attempt) => !kept.has(attempt.index));
    if (reset) records.push({ taskId, reset: true });
    const written = new Map(
      old.map((attempt) => [attempt.index, JSON.stringify(attempt)]),
    );
    for (const attempt of next)
      if (reset || written.get(attempt.index) !== JSON.stringify(attempt))
        records.push({ taskId, attempt: structuredClone(attempt) });
  }
  return records;
}

/**
 * The entries of `after` that are not in `before` yet. Logs only grow at the end and lose entries
 * at the start (the in-memory cap), so the new entries are what follows the longest end of
 * `before` that starts `after`.
 */
export function newLogEntries(
  before: readonly OrchestratorLogEntry[],
  after: readonly OrchestratorLogEntry[],
): OrchestratorLogEntry[] {
  const old = before.map((entry) => JSON.stringify(entry));
  const next = after.map((entry) => JSON.stringify(entry));
  for (let size = Math.min(old.length, next.length); size > 0; size--) {
    let same = true;
    for (let i = 0; i < size && same; i++)
      same = old[old.length - size + i] === next[i];
    if (same) return after.slice(size).map((entry) => structuredClone(entry));
  }
  return after.map((entry) => structuredClone(entry));
}

async function syncDirectory(directory: string): Promise<void> {
  const folder = await open(directory, "r");
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

/**
 * Creates the folder, and syncs the parent of each folder it creates so the new entries survive a
 * power loss.
 */
async function ensureDirectory(directory: string): Promise<void> {
  const first = await mkdir(directory, { recursive: true });
  if (!first) return;
  for (let created = directory; ; created = path.dirname(created)) {
    await syncDirectory(path.dirname(created));
    if (created === first || path.dirname(created) === created) break;
  }
}

/**
 * Appends the lines and syncs the file; syncs the folder too when the file is new. A file whose
 * last line was cut by a crash gets a newline first, so the cut line does not swallow the next one.
 */
async function appendLines(
  file: string,
  lines: readonly string[],
): Promise<void> {
  if (!lines.length) return;
  const created = await stat(file).then(
    () => false,
    () => true,
  );
  const handle = await open(file, "a+");
  try {
    const { size } = await handle.stat();
    let prefix = "";
    if (size > 0) {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = "\n";
    }
    await handle.writeFile(`${prefix}${lines.join("\n")}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (created) await syncDirectory(path.dirname(file));
}

/** The last `bytes` of a file, starting at a whole line. */
async function readTail(file: string, bytes: number): Promise<string> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    await handle.close();
  }
}

/** Enough for the in-memory tail (100 entries of a few hundred bytes) with room to spare. */
const LOG_TAIL_BYTES = 512 * 1024;

function parseLines<T>(text: string, schema: z.ZodType<T>, file: string): T[] {
  const parsed: T[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const result = schema.safeParse(JSON.parse(line));
      if (result.success) parsed.push(result.data);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  if (skipped) console.warn(`Skipped ${skipped} unreadable line(s) in ${file}`);
  return parsed;
}

export function directoryRecordFiles(
  directory: string,
  now: () => Date = () => new Date(),
): RecordFiles {
  const attemptsDirectory = path.join(directory, "attempts");
  const logsDirectory = path.join(directory, "orchestrator-logs");
  return {
    async readAttempts() {
      let names: string[];
      try {
        names = await readdir(attemptsDirectory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
      }
      const records: AttemptRecord[] = [];
      // Day names sort in time order; within a file, lines are in write order.
      for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
        const file = path.join(attemptsDirectory, name);
        for (const line of parseLines(
          await readFile(file, "utf8"),
          attemptLine,
          file,
        ))
          records.push(
            "reset" in line
              ? { taskId: line.taskId, reset: true }
              : { taskId: line.taskId, attempt: line.attempt },
          );
      }
      return foldAttempts(records);
    },
    async appendAttempts(records) {
      if (!records.length) return;
      const at = now().toISOString();
      await ensureDirectory(attemptsDirectory);
      await appendLines(
        path.join(attemptsDirectory, `${at.slice(0, 10)}.jsonl`),
        records.map((record) => JSON.stringify({ at, ...record })),
      );
    },
    async readLogs(orchestratorIds, limit) {
      const logs: Record<string, OrchestratorLogEntry[]> = {};
      await Promise.all(
        orchestratorIds.map(async (id) => {
          let file: string;
          try {
            file = path.join(logsDirectory, logFileName(id));
            const entries = parseLines(
              await readTail(file, LOG_TAIL_BYTES),
              orchestratorLogEntrySchema,
              file,
            );
            if (entries.length) logs[id] = entries.slice(-limit);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            console.warn(
              `Log of orchestrator ${id} could not be read:`,
              error instanceof Error ? error.message : error,
            );
          }
        }),
      );
      return logs;
    },
    async appendLogs(orchestratorId, entries) {
      if (!entries.length) return;
      const file = path.join(logsDirectory, logFileName(orchestratorId));
      await ensureDirectory(logsDirectory);
      await appendLines(
        file,
        entries.map((entry) => JSON.stringify(entry)),
      );
    },
    async removeLogs(orchestratorId) {
      await rm(path.join(logsDirectory, logFileName(orchestratorId)), {
        force: true,
      });
    },
  };
}

/** For tests and for a Store built without files: the same contract, kept in memory. */
export function memoryRecordFiles(): RecordFiles & {
  attempts: AttemptRecord[];
  logs: Map<string, OrchestratorLogEntry[]>;
} {
  const attempts: AttemptRecord[] = [];
  const logs = new Map<string, OrchestratorLogEntry[]>();
  return {
    attempts,
    logs,
    async readAttempts() {
      return structuredClone(foldAttempts(attempts));
    },
    async appendAttempts(records) {
      attempts.push(...structuredClone(records));
    },
    async readLogs(orchestratorIds, limit) {
      const out: Record<string, OrchestratorLogEntry[]> = {};
      for (const id of orchestratorIds) {
        const entries = logs.get(id);
        if (entries?.length) out[id] = structuredClone(entries.slice(-limit));
      }
      return out;
    },
    async appendLogs(orchestratorId, entries) {
      logFileName(orchestratorId);
      logs.set(orchestratorId, [
        ...(logs.get(orchestratorId) ?? []),
        ...structuredClone(entries),
      ]);
    },
    async removeLogs(orchestratorId) {
      logs.delete(orchestratorId);
    },
  };
}
