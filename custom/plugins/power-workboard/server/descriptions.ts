// CUSTOM(task-description-files): a task's description lives in its own file,
// `<PASEO_HOME>/plugin-data/power-workboard/tasks/<taskId>.md`, instead of the board's JSON. The
// Store (server/store.ts) owns the in-memory copy and decides when a file is written or removed.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Where the Store keeps description texts. Every method takes a task id, never a path. */
export interface DescriptionFiles {
  /**
   * The texts of the given tasks that have a file. A task without one is left out, and so is a
   * file that cannot be read: that is logged, and never stops the board from opening.
   */
  readAll(taskIds: readonly string[]): Promise<Map<string, string>>;
  /**
   * Replaces the text in one step: a reader sees the old file or the new one, never a part. The
   * file's data is on disk when this resolves; its name is only after `flush`.
   */
  write(taskId: string, text: string): Promise<void>;
  /** Makes the renames of earlier writes survive a power loss (fsync of the folder). */
  flush(): Promise<void>;
  remove(taskId: string): Promise<void>;
}

function paseoHome(env: NodeJS.ProcessEnv): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  return path.resolve(
    raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw,
  );
}

export function defaultDescriptionDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(paseoHome(env), "plugin-data", "power-workboard", "tasks");
}

/** The board's JSON as the host's settings store keeps it. */
export function defaultSettingsFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(
    paseoHome(env),
    "plugin-settings",
    "power-workboard",
    "workboard-data.json",
  );
}

/** The copy of the board's JSON taken before descriptions first move out of it. */
export function preDescriptionsBackupFile(settingsFile: string): string {
  return path.join(
    path.dirname(settingsFile),
    "workboard-data.pre-descriptions.json",
  );
}

/**
 * Copies `source` to `target` unless `target` already exists, and syncs the copy to disk. True
 * when it copied.
 */
export async function backupOnce(
  source: string,
  target: string,
): Promise<boolean> {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  await syncPath(target);
  return true;
}

async function syncPath(target: string): Promise<void> {
  const handle = await open(target, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            console.warn(
              `Description of task ${taskId} could not be read:`,
              error instanceof Error ? error.message : error,
            );
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
        // The data reaches the disk before the rename, so a power loss never leaves an empty file
        // under the final name.
        const handle = await open(temporary, "wx");
        try {
          await handle.writeFile(text, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async flush() {
      await syncPath(directory);
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
    async flush() {},
    async remove(taskId) {
      texts.delete(taskId);
    },
  };
}
