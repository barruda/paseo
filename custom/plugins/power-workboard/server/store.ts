import { dataSchema, type Data } from "../shared/model";
import { z } from "zod";
import { memoryDescriptionFiles, type DescriptionFiles } from "./descriptions"; // CUSTOM(task-description-files)
export interface SettingsBacking {
  read(): Promise<unknown>;
  write(revision: string, values: Data): Promise<unknown>;
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
// Tests reopen a Store on the same backing; without files of their own they share one set.
const memoryFiles = new WeakMap<SettingsBacking, DescriptionFiles>();
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
  constructor(
    private backing: SettingsBacking,
    files?: DescriptionFiles,
  ) {
    if (files) this.files = files;
    else {
      const shared = memoryFiles.get(backing) ?? memoryDescriptionFiles();
      memoryFiles.set(backing, shared);
      this.files = shared;
    }
  }
  get current(): Data {
    return structuredClone(this.value);
  }
  /** CUSTOM(task-description-files): the one accessor for a task's description. */
  description(taskId: string): string {
    return this.texts.get(taskId) ?? "";
  }
  /** True while some description is still only in the JSON; `moveDescriptions` fixes it. */
  get hasLegacyDescriptions(): boolean {
    return this.legacy.size > 0;
  }
  /** Writes each description still in the JSON to its file, then clears the JSON copy. */
  moveDescriptions(): Promise<void> {
    return this.update(() => undefined);
  }
  load(): Promise<void> {
    const work = this.queue.then(async () => {
      const loaded = readResult.parse(await this.backing.read());
      if (loaded.status !== "ready") throw new Error(loaded.error);
      const values = loaded.values;
      const texts = await this.files.readAll(values.tasks.map((t) => t.id));
      const legacy = new Set<string>();
      for (const task of values.tasks) {
        if (!task.description) continue;
        texts.set(task.id, task.description);
        legacy.add(task.id);
        task.description = "";
      }
      this.value = values;
      this.revision = loaded.revision;
      this.texts = texts;
      this.legacy = legacy;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  update(
    change: (data: Data, descriptions: DescriptionEditor) => void,
  ): Promise<void> {
    const work = this.queue.then(async () => {
      if (this.revision === null) throw new Error("Storage is unavailable");
      const next = this.current;
      const staged = new Map<string, string>();
      change(next, {
        get: (taskId) => staged.get(taskId) ?? this.description(taskId),
        set: (taskId, text) => staged.set(taskId, text),
      });
      const writes = this.stageDescriptions(next, staged);
      if (!writes.size && JSON.stringify(next) === JSON.stringify(this.value))
        return;
      next.revision = this.value.revision + 1;
      const parsed = dataSchema.parse(next);
      // The files go first: the JSON stops carrying a text only once its file is written.
      if (writes.size) await this.writeFiles(writes);
      try {
        const saved = writeResult.parse(
          await this.backing.write(this.revision, parsed),
        );
        if (saved.status !== "saved") throw new Error(saved.error);
        this.value = saved.values;
        this.revision = saved.revision;
      } catch (error) {
        // The host may have saved even if the reply was lost. Require a read before more writes.
        this.revision = null;
        throw error;
      }
      for (const taskId of writes.keys()) this.legacy.delete(taskId);
      const kept = new Set(next.tasks.map((task) => task.id));
      const removed = [...this.texts.keys()].filter((id) => !kept.has(id));
      if (removed.length) await this.removeFiles(removed);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  /** Each file that was written is the text from now on, even if another one failed. */
  private async writeFiles(writes: Map<string, string>): Promise<void> {
    const results = await Promise.allSettled(
      [...writes].map(async ([taskId, text]) => {
        await this.files.write(taskId, text);
        this.texts.set(taskId, text);
      }),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
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
   * set straight on `task.description` is moved out too, so the JSON never keeps one.
   */
  private stageDescriptions(
    next: Data,
    staged: Map<string, string>,
  ): Map<string, string> {
    const writes = new Map<string, string>();
    for (const task of next.tasks) {
      if (task.description) {
        if (!staged.has(task.id)) staged.set(task.id, task.description);
        task.description = "";
      }
      const legacy = this.legacy.has(task.id);
      const text = staged.get(task.id) ?? this.description(task.id);
      if (!legacy && text === this.description(task.id)) continue;
      writes.set(task.id, text);
      task.descriptionLength = text.length;
      task.descriptionRevision += 1;
    }
    return writes;
  }
}
