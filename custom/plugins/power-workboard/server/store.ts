import {
  dataSchema,
  ORCHESTRATOR_LOG_LIMIT,
  type Data,
  type OrchestratorLogEntry,
} from "../shared/model";
import type { Attempt } from "../shared/assistant";
import { z } from "zod";
import { memoryDescriptionFiles, type DescriptionFiles } from "./descriptions"; // CUSTOM(task-description-files)
// CUSTOM(task-records-jsonl)
import {
  attemptRecords,
  memoryRecordFiles,
  newLogEntries,
  type AttemptRecord,
  type RecordFiles,
} from "./records";
export interface SettingsBacking {
  read(): Promise<unknown>;
  write(revision: string, values: Data): Promise<unknown>;
  /**
   * CUSTOM(task-description-files): keeps a copy of the stored JSON before descriptions (or, with
   * "records", attempts and orchestrator logs) first move out of it. Called before every move;
   * only the first one of each kind copies.
   */
  backup?(what: "descriptions" | "records"): Promise<void>;
}
/**
 * CUSTOM(task-description-files): what an `update` uses to read and change task descriptions.
 * `get` sees the texts set earlier in the same update.
 */
export interface DescriptionEditor {
  get(taskId: string): string;
  set(taskId: string, text: string): void;
}
const readResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    revision: z.string(),
    values: dataSchema,
  }),
  z.object({ status: z.literal("invalid"), error: z.string() }),
]);
const writeResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("saved"),
    revision: z.string(),
    values: dataSchema,
  }),
  z.object({ status: z.literal("invalid"), error: z.string() }),
  z.object({ status: z.literal("conflict"), error: z.string() }),
]);
const NONE: ReadonlySet<string> = new Set();
/** CUSTOM(task-records-jsonl): see `Store.planRecords`. */
interface RecordPlan {
  kept: { attempts: boolean; logs: boolean };
  attempts: AttemptRecord[];
  attemptsAfter: Record<string, Attempt[]>;
  removedLogs: string[];
  logAppends: {
    id: string;
    added: OrchestratorLogEntry[];
    entries: OrchestratorLogEntry[];
  }[];
  work: boolean;
}
// Tests reopen a Store on the same backing; without files of their own they share one set.
const memoryFiles = new WeakMap<SettingsBacking, DescriptionFiles>();
const memoryRecords = new WeakMap<SettingsBacking, RecordFiles>();
/**
 * CUSTOM(task-records-jsonl): attempts of tasks that left the board stay in memory this long after
 * they started, so their agents still count as the board's (PM tools, wakes, Reports).
 */
const RECENT_ATTEMPTS_MS = 30 * 24 * 60 * 60 * 1000;
export class Store {
  private value: Data = dataSchema.parse({});
  private revision: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * CUSTOM(task-description-files): every task's description, kept in memory as the cache behind
   * `description()`. The board's JSON keeps only `descriptionLength` and `descriptionRevision`;
   * the text is in `files`. In memory, `task.description` is always "".
   */
  private texts = new Map<string, string>();
  /**
   * Tasks whose text is still in the JSON's `description` (saved before the files existed, or a
   * migration that was interrupted). That copy wins over a file until a save moves it out.
   */
  private legacy = new Set<string>();
  private files: DescriptionFiles;
  /**
   * CUSTOM(task-records-jsonl): `assistant.attempts` and `orchestratorLogs` stay in `value` (every
   * reader is unchanged), but the JSON saves them as `{}`: they are appended to `records`. The
   * `*OnDisk` copies are what the files hold, and each save appends the difference.
   */
  private records: RecordFiles;
  private attemptsOnDisk: Record<string, Attempt[]> = {};
  private logsOnDisk: Record<string, OrchestratorLogEntry[]> = {};
  /** The JSON still carries them (an older version, or a failed append); a move fixes it. */
  private legacyAttempts = false;
  private legacyLogs = false;
  /**
   * The attempt files could not be read, so `attemptsOnDisk` is unknown: appending could reuse an
   * index the files already have. Attempts stay in the JSON until a load reads the files.
   */
  private attemptsUnread = false;
  constructor(
    private backing: SettingsBacking,
    files?: DescriptionFiles,
    records?: RecordFiles,
  ) {
    if (files) this.files = files;
    else {
      const shared = memoryFiles.get(backing) ?? memoryDescriptionFiles();
      memoryFiles.set(backing, shared);
      this.files = shared;
    }
    if (records) this.records = records;
    else {
      const shared = memoryRecords.get(backing) ?? memoryRecordFiles();
      memoryRecords.set(backing, shared);
      this.records = shared;
    }
  }
  get current(): Data {
    return structuredClone(this.value);
  }
  /** CUSTOM(factory): reads a field without cloning the whole data; `read` must not keep or change it. */
  peek<T>(read: (data: Readonly<Data>) => T): T {
    return read(this.value);
  }
  /** CUSTOM(task-description-files): the one accessor for a task's description. */
  description(taskId: string): string {
    return this.texts.get(taskId) ?? "";
  }
  /** True while some description is still only in the JSON; `moveDescriptions` fixes it. */
  get hasLegacyDescriptions(): boolean {
    return this.legacy.size > 0;
  }
  /**
   * Writes each description still in the JSON to its file, then clears the JSON copy. A failed
   * backup stops the move: the texts stay in the JSON, where they are still read.
   */
  async moveDescriptions(): Promise<void> {
    if (!this.legacy.size) return;
    await this.backing.backup?.("descriptions");
    await this.save(() => undefined, true);
  }
  /** CUSTOM(task-records-jsonl): true while the JSON still carries attempts or logs. */
  get hasLegacyRecords(): boolean {
    return (this.legacyAttempts && !this.attemptsUnread) || this.legacyLogs;
  }
  /**
   * CUSTOM(task-records-jsonl): appends what the JSON still carries to the files, then clears the
   * JSON copy. A failed backup stops the move; a failed append keeps that kind in the JSON.
   */
  async moveRecords(): Promise<void> {
    if (!this.hasLegacyRecords) return;
    await this.backing.backup?.("records");
    await this.save(() => undefined, "records");
  }
  load(): Promise<void> {
    const work = this.queue.then(async () => {
      const loaded = readResult.parse(await this.backing.read());
      if (loaded.status !== "ready") throw new Error(loaded.error);
      const values = loaded.values;
      // A folder that cannot be read leaves the texts to the JSON; the board still opens.
      const texts = await this.files
        .readAll(values.tasks.map((t) => t.id))
        .catch((error: unknown) => {
          console.warn(
            "Task descriptions could not be read:",
            error instanceof Error ? error.message : error,
          );
          return new Map<string, string>();
        });
      const legacy = new Set<string>();
      for (const task of values.tasks) {
        if (!task.description) continue;
        texts.set(task.id, task.description);
        legacy.add(task.id);
        task.description = "";
      }
      await this.loadRecords(values);
      this.value = values;
      this.revision = loaded.revision;
      this.texts = texts;
      this.legacy = legacy;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  /**
   * CUSTOM(task-records-jsonl): reads the files and fills `values` with what the JSON does not
   * carry. A JSON copy (an older version, or an append that failed) is merged into the files' copy
   * by attempt index and wins on the same index: it is the newer one, and the next move appends it.
   */
  private async loadRecords(values: Data): Promise<void> {
    const jsonAttempts = values.assistant.attempts;
    const jsonLogs = values.orchestratorLogs;
    let disk: Record<string, Attempt[]> = {};
    this.attemptsUnread = false;
    try {
      disk = await this.records.readAttempts();
    } catch (error) {
      this.attemptsUnread = true;
      console.warn(
        "Task attempts could not be read; new ones stay in the board JSON:",
        error instanceof Error ? error.message : error,
      );
    }
    const onBoard = new Set(values.tasks.map((task) => task.id));
    const recent = Date.now() - RECENT_ATTEMPTS_MS;
    const attempts: Record<string, Attempt[]> = {};
    for (const [taskId, list] of Object.entries(disk))
      if (
        onBoard.has(taskId) ||
        list.some((attempt) => Date.parse(attempt.startedAt) >= recent)
      )
        attempts[taskId] = list;
    for (const taskId of Object.keys(jsonAttempts))
      if (disk[taskId] && !attempts[taskId]) attempts[taskId] = disk[taskId];
    this.attemptsOnDisk = structuredClone(attempts);
    for (const [taskId, list] of Object.entries(jsonAttempts)) {
      const byIndex = new Map(
        (attempts[taskId] ?? []).map((attempt) => [attempt.index, attempt]),
      );
      for (const attempt of list) byIndex.set(attempt.index, attempt);
      attempts[taskId] = [...byIndex.values()].sort(
        (left, right) => left.index - right.index,
      );
    }
    values.assistant.attempts = attempts;
    this.legacyAttempts = Object.keys(jsonAttempts).length > 0;

    const ids = new Set([
      ...values.orchestrators.map((config) => config.id),
      ...Object.keys(jsonLogs),
    ]);
    const logs = await this.records
      .readLogs([...ids], ORCHESTRATOR_LOG_LIMIT)
      .catch((error: unknown) => {
        console.warn(
          "Orchestrator logs could not be read:",
          error instanceof Error ? error.message : error,
        );
        return {} as Record<string, OrchestratorLogEntry[]>;
      });
    this.logsOnDisk = structuredClone(logs);
    values.orchestratorLogs = { ...logs, ...jsonLogs };
    this.legacyLogs = Object.keys(jsonLogs).length > 0;
  }
  update(
    change: (data: Data, descriptions: DescriptionEditor) => void,
  ): Promise<void> {
    return this.save(change, false);
  }
  /**
   * `moving`: also write what the JSON still carries to files: `true` the descriptions
   * (`moveDescriptions`), "records" the attempts and logs (`moveRecords`).
   */
  private save(
    change: (data: Data, descriptions: DescriptionEditor) => void,
    moving: boolean | "records",
  ): Promise<void> {
    const work = this.queue.then(async () => {
      if (this.revision === null) throw new Error("Storage is unavailable");
      const next = this.current;
      const staged = new Map<string, string>();
      change(next, {
        get: (taskId) => staged.get(taskId) ?? this.description(taskId),
        set: (taskId, text) => staged.set(taskId, text),
      });
      const writes = this.stageDescriptions(next, staged, moving === true);
      if (
        !writes.size &&
        moving !== "records" &&
        JSON.stringify(next) === JSON.stringify(this.value)
      )
        return;
      next.revision = this.value.revision + 1;
      // The files go first, synced to disk: the JSON stops carrying a text only once its file is
      // written. A text whose file failed stays in the JSON, where the next load reads it.
      const failed = writes.size ? await this.writeFiles(writes) : NONE;
      for (const task of next.tasks)
        if (failed.has(task.id)) task.description = writes.get(task.id)!;
        else if (this.legacy.has(task.id) && !writes.has(task.id))
          task.description = this.description(task.id);
      const parsed = dataSchema.parse(next);
      // CUSTOM(task-records-jsonl): appended before the JSON, like the description files.
      const plan = this.planRecords(parsed, moving === "records");
      const kept = plan.work ? await this.writeRecords(plan) : plan.kept;
      const stored: Data = {
        ...parsed,
        orchestratorLogs: kept.logs ? parsed.orchestratorLogs : {},
        assistant: {
          ...parsed.assistant,
          attempts: kept.attempts ? parsed.assistant.attempts : {},
        },
      };
      try {
        const saved = writeResult.parse(
          await this.backing.write(this.revision, stored),
        );
        if (saved.status !== "saved") throw new Error(saved.error);
        for (const task of saved.values.tasks) task.description = "";
        saved.values.assistant.attempts = parsed.assistant.attempts;
        saved.values.orchestratorLogs = parsed.orchestratorLogs;
        this.value = saved.values;
        this.revision = saved.revision;
        this.legacyAttempts = kept.attempts;
        this.legacyLogs = kept.logs;
      } catch (error) {
        // The host may have saved even if the reply was lost. Require a read before more writes.
        this.revision = null;
        throw error;
      }
      for (const taskId of writes.keys())
        if (failed.has(taskId)) this.legacy.add(taskId);
        else this.legacy.delete(taskId);
      const remaining = new Set(next.tasks.map((task) => task.id));
      const removed = [...this.texts.keys()].filter((id) => !remaining.has(id));
      if (removed.length) await this.removeFiles(removed);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  /**
   * CUSTOM(task-records-jsonl): what this save appends or removes, and which kinds the JSON must
   * keep: the ones still legacy (outside a move) or unread. Synchronous, so a save with nothing to
   * append adds no tick to `update` (tests count them).
   */
  private planRecords(data: Data, moving: boolean): RecordPlan {
    const kept = {
      attempts: this.attemptsUnread || (this.legacyAttempts && !moving),
      logs: this.legacyLogs && !moving,
    };
    const attempts = kept.attempts
      ? []
      : attemptRecords(this.attemptsOnDisk, data.assistant.attempts);
    const logs = data.orchestratorLogs;
    const removedLogs = kept.logs
      ? []
      : Object.keys(this.logsOnDisk).filter((id) => !(id in logs));
    const logAppends = kept.logs
      ? []
      : Object.entries(logs).flatMap(([id, entries]) => {
          const added = newLogEntries(this.logsOnDisk[id] ?? [], entries);
          return added.length ? [{ id, added, entries }] : [];
        });
    return {
      kept,
      attempts,
      attemptsAfter: data.assistant.attempts,
      removedLogs,
      logAppends,
      work: !!(attempts.length || removedLogs.length || logAppends.length),
    };
  }
  /** Appends the plan before the JSON is saved. A failed append keeps that kind in the JSON. */
  private async writeRecords(
    plan: RecordPlan,
  ): Promise<{ attempts: boolean; logs: boolean }> {
    const kept = { ...plan.kept };
    const warn = (what: string, error: unknown) =>
      console.warn(
        `${what}; it stays in the board JSON:`,
        error instanceof Error ? error.message : error,
      );
    if (plan.attempts.length)
      try {
        await this.records.appendAttempts(plan.attempts);
        this.attemptsOnDisk = structuredClone(plan.attemptsAfter);
      } catch (error) {
        kept.attempts = true;
        warn("Task attempts were not appended", error);
      }
    for (const id of plan.removedLogs) {
      try {
        await this.records.removeLogs(id);
      } catch (error) {
        console.error(
          `Log file of removed orchestrator ${id} was not deleted:`,
          error instanceof Error ? error.message : error,
        );
      }
      delete this.logsOnDisk[id];
    }
    for (const { id, added, entries } of plan.logAppends)
      try {
        await this.records.appendLogs(id, added);
        this.logsOnDisk[id] = structuredClone(entries);
      } catch (error) {
        kept.logs = true;
        warn(`Log of orchestrator ${id} was not appended`, error);
      }
    return kept;
  }
  /**
   * Writes and syncs the files, then syncs the folder so the renames survive a power loss. Returns
   * the tasks whose file is not safely on disk; their text must stay in the JSON.
   */
  private async writeFiles(writes: Map<string, string>): Promise<Set<string>> {
    const failed = new Set<string>();
    const warn = (what: string, error: unknown) =>
      console.warn(
        `${what}; the text stays in the board JSON:`,
        error instanceof Error ? error.message : error,
      );
    await Promise.all(
      [...writes].map(async ([taskId, text]) => {
        this.texts.set(taskId, text);
        try {
          await this.files.write(taskId, text);
        } catch (error) {
          failed.add(taskId);
          warn(`Description file of task ${taskId} was not written`, error);
        }
      }),
    );
    if (failed.size < writes.size)
      try {
        await this.files.flush();
      } catch (error) {
        for (const taskId of writes.keys()) failed.add(taskId);
        warn("The description folder was not synced", error);
      }
    return failed;
  }
  /** The files of tasks that left the board. A file that stays behind is only clutter. */
  private async removeFiles(taskIds: readonly string[]): Promise<void> {
    for (const taskId of taskIds) {
      this.texts.delete(taskId);
      this.legacy.delete(taskId);
      await this.files.remove(taskId).catch((error: unknown) => {
        console.error(
          `Description file of removed task ${taskId} was not deleted:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
  /**
   * The descriptions this save must write, with each task's length and revision updated. A text
   * set straight on `task.description` is moved out too. A text still in the JSON is written only
   * by a move, so a file that keeps failing is not retried on every save.
   */
  private stageDescriptions(
    next: Data,
    staged: Map<string, string>,
    moving: boolean,
  ): Map<string, string> {
    const writes = new Map<string, string>();
    for (const task of next.tasks) {
      if (task.description) {
        if (!staged.has(task.id)) staged.set(task.id, task.description);
        task.description = "";
      }
      const forced = moving && this.legacy.has(task.id);
      const text = staged.get(task.id) ?? this.description(task.id);
      if (!forced && text === this.description(task.id)) continue;
      writes.set(task.id, text);
      task.descriptionLength = text.length;
      task.descriptionRevision += 1;
    }
    return writes;
  }
}
