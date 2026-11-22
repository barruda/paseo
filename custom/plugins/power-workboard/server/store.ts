import { dataSchema, type Data } from "../shared/model";
import { z } from "zod";
export interface SettingsBacking {
  read(): Promise<unknown>;
  write(revision: string, values: Data): Promise<unknown>;
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
 * the config fields this way (shared/factory/active.ts).
 */
export interface StoreView {
  apply(data: Data): void;
  restore(next: Data, saved: Readonly<Data>): void;
}
export class Store {
  private value: Data = dataSchema.parse({});
  private view: StoreView | null = null;
  private revision: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private backing: SettingsBacking) {}
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
  load(): Promise<void> {
    const work = this.queue.then(async () => {
      const loaded = readResult.parse(await this.backing.read());
      if (loaded.status !== "ready") throw new Error(loaded.error);
      this.value = loaded.values;
      this.revision = loaded.revision;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  update(change: (data: Data) => void): Promise<void> {
    const work = this.queue.then(async () => {
      if (this.revision === null) throw new Error("Storage is unavailable");
      const next = this.current;
      change(next);
      this.view?.restore(next, this.value); // CUSTOM(factory)
      if (JSON.stringify(next) === JSON.stringify(this.value)) return;
      next.revision = this.value.revision + 1;
      const parsed = dataSchema.parse(next);
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
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
