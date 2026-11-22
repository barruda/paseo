// CUSTOM(task-description-files): a task's description lives in its own file,
// `<PASEO_HOME>/plugin-data/power-workboard/tasks/<taskId>.md`, instead of the board's JSON. The
// Store (server/store.ts) owns the in-memory copy and decides when a file is written or removed.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Where the Store keeps description texts. Every method takes a task id, never a path. */
export interface DescriptionFiles {
  /** The texts of the given tasks that have a file; a task without one is left out. */
  readAll(taskIds: readonly string[]): Promise<Map<string, string>>;
  /** Replaces the text in one step: a reader sees the old file or the new one, never a part. */
  write(taskId: string, text: string): Promise<void>;
  remove(taskId: string): Promise<void>;
}

export function defaultDescriptionDirectory(
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
    "tasks",
  );
}

/** Task ids become file names, so anything that could leave the folder is refused. */
function fileName(taskId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId))
    throw new Error(`Invalid task id for a description file: ${taskId}`);
  return `${taskId}.md`;
}

export function directoryDescriptionFiles(directory: string): DescriptionFiles {
  return {
    async readAll(taskIds) {
      const texts = new Map<string, string>();
      await Promise.all(
        taskIds.map(async (taskId) => {
          try {
            texts.set(
              taskId,
              await readFile(path.join(directory, fileName(taskId)), "utf8"),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }),
      );
      return texts;
    },
    async write(taskId, text) {
      const file = path.join(directory, fileName(taskId));
      const temporary = `${file}.${randomUUID().slice(0, 8)}.tmp`;
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(temporary, text, "utf8");
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async remove(taskId) {
      await rm(path.join(directory, fileName(taskId)), { force: true });
    },
  };
}

/** For tests and for a Store built without files: the same contract, kept in memory. */
export function memoryDescriptionFiles(
  initial: Record<string, string> = {},
): DescriptionFiles & { texts: Map<string, string> } {
  const texts = new Map(Object.entries(initial));
  return {
    texts,
    async readAll(taskIds) {
      return new Map(
        taskIds.flatMap((id) => {
          const text = texts.get(id);
          return text === undefined ? [] : [[id, text] as const];
        }),
      );
    },
    async write(taskId, text) {
      fileName(taskId);
      texts.set(taskId, text);
    },
    async remove(taskId) {
      texts.delete(taskId);
    },
  };
}
