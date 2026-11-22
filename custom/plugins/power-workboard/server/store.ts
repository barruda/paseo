import { dataSchema, type Data } from "../shared/model";
import { z } from "zod";
import { memoryDescriptionFiles, type DescriptionFiles } from "./descriptions"; // CUSTOM(task-description-files)
export interface SettingsBacking {
  read(): Promise<unknown>;
  write(revision: string, values: Data): Promise<unknown>;
  /**
   * CUSTOM(task-description-files): keeps a copy of the stored JSON before descriptions first move
   * out of it. Called before every move; only the first one copies.
   */
  backup?(): Promise<void>;
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
/**
 * CUSTOM(factory): a view over the saved data. `apply` changes the copy every read returns;
 * `restore` undoes it on the changed copy before a save. Active mode puts the compiled factory in
 * the config fields this way (shared/factory/active.ts). For an update marked `factory`, `restore`
 * may return work the save awaits first (active mode writes the config change to the factory); if
 * it fails, nothing is saved.
 */
export interface StoreView {
  apply(data: Data): void;
  restore(
    next: Data,
    saved: Readonly<Data>,
    options: UpdateOptions,
  ): (() => Promise<void>) | void;
}
/** CUSTOM(factory): `factory`: a user's config edit, which active mode writes to the factory. */
export type UpdateOptions = { factory?: boolean };
const NONE: ReadonlySet<string> = new Set();
// Tests reopen a Store on the same backing; without files of their own they share one set.
const memoryFiles = new WeakMap<SettingsBacking, DescriptionFiles>();
export class Store {
  private value: Data = dataSchema.parse({});
  private view: StoreView | null = null;
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
    const copy = structuredClone(this.value);
    this.view?.apply(copy); // CUSTOM(factory)
    return copy;
  }
  /** CUSTOM(factory): reads and writes go through `view` from now on; null drops it. */
  setView(view: StoreView | null): void {
    this.view = view;
  }
  /**
   * CUSTOM(factory): reads a field of the saved data (no view) without cloning the whole data;
   * `read` must not keep or change it.
   */
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
    await this.backing.backup?.();
    await this.save(() => undefined, true);
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
    options: UpdateOptions = {}, // CUSTOM(factory)
  ): Promise<void> {
    return this.save(change, false, options);
  }
  /** `moving`: also write the texts still in the JSON to their files (`moveDescriptions`). */
  private save(
    change: (data: Data, descriptions: DescriptionEditor) => void,
    moving: boolean,
    options: UpdateOptions = {},
  ): Promise<void> {
    const work = this.queue.then(async () => {
      if (this.revision === null) throw new Error("Storage is unavailable");
      const next = this.current;
      const staged = new Map<string, string>();
      change(next, {
        get: (taskId) => staged.get(taskId) ?? this.description(taskId),
        set: (taskId, text) => staged.set(taskId, text),
      });
      // CUSTOM(factory): awaited only when there is a factory write, so plain saves keep their ticks.
      const pending = this.view?.restore(next, this.value, options);
      if (pending) await pending();
      const writes = this.stageDescriptions(next, staged, moving);
      if (!writes.size && JSON.stringify(next) === JSON.stringify(this.value))
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
      try {
        const saved = writeResult.parse(
          await this.backing.write(this.revision, parsed),
        );
        if (saved.status !== "saved") throw new Error(saved.error);
        for (const task of saved.values.tasks) task.description = "";
        this.value = saved.values;
        this.revision = saved.revision;
      } catch (error) {
        // The host may have saved even if the reply was lost. Require a read before more writes.
        this.revision = null;
        throw error;
      }
      for (const taskId of writes.keys())
        if (failed.has(taskId)) this.legacy.add(taskId);
        else this.legacy.delete(taskId);
      const kept = new Set(next.tasks.map((task) => task.id));
      const removed = [...this.texts.keys()].filter((id) => !kept.has(id));
      if (removed.length) await this.removeFiles(removed);
    });
    this.queue = work.catch(() => undefined);
    return work;
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
