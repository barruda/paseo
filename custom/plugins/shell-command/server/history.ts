import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";

export const MAX_HISTORY_PER_PROJECT = 500;

const fileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), z.array(z.string())),
});
type HistoryFile = z.output<typeof fileSchema>;

export function defaultHistoryFile(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.join(path.resolve(home), "plugin-data", "shell-command", "history.json");
}

/** Puts `command` first, drops its older copy, and keeps the newest `limit` entries. */
export function pushHistory(
  commands: readonly string[],
  command: string,
  limit = MAX_HISTORY_PER_PROJECT,
): string[] {
  return [command, ...commands.filter((entry) => entry !== command)].slice(0, limit);
}

/** One JSON file for every project. Writes are serialized and atomic (temp file + rename). */
export class HistoryStore {
  private file: HistoryFile | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(key: string): Promise<string[]> {
    const file = await this.load();
    return file.projects[key] ?? [];
  }

  add(key: string, command: string): Promise<void> {
    const run = async () => {
      const file = await this.load();
      file.projects[key] = pushHistory(file.projects[key] ?? [], command);
      await this.save(file);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  private async load(): Promise<HistoryFile> {
    if (this.file) return this.file;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.file = { version: 1, projects: {} };
      return this.file;
    }
    // Refuse to start from an empty history over a file we can't read: saving would wipe it.
    this.file = fileSchema.parse(JSON.parse(raw));
    return this.file;
  }

  private async save(file: HistoryFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}

/**
 * History is kept per project, so a project's worktrees share it. A workspace never changes
 * project, so the lookup is cached. Without a workspace (or a project), history falls back to the
 * directory.
 */
export class HistoryKeyResolver {
  private readonly projectByWorkspace = new Map<string, Promise<string | null>>();

  async resolve(
    input: { cwd: string; workspaceId?: string },
    { paseo }: PluginHandlerContext,
  ): Promise<string> {
    if (input.workspaceId) {
      let lookup = this.projectByWorkspace.get(input.workspaceId);
      if (!lookup) {
        lookup = paseo.workspaces
          .ref(input.workspaceId)
          .refresh()
          .then((workspace) => workspace?.projectId ?? null);
        this.projectByWorkspace.set(input.workspaceId, lookup);
        // A failed lookup is retried on the next call instead of pinning the fallback.
        lookup.catch(() => this.projectByWorkspace.delete(input.workspaceId!));
      }
      const projectId = await lookup.catch(() => null);
      if (projectId) return `project:${projectId}`;
    }
    return `cwd:${path.resolve(input.cwd)}`;
  }
}
