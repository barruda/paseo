import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { type WorkspaceTasks, workspaceTasksSchema } from "../shared/tasks";
import { EMPTY_WORKSPACE } from "./model";

const fileSchema = z.object({
  version: z.literal(1),
  workspaces: z.record(z.string(), workspaceTasksSchema),
});
type TaskFile = z.output<typeof fileSchema>;

export function defaultTasksFile(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.join(path.resolve(home), "plugin-data", "workspace-tasks", "tasks.json");
}

/** One JSON file for every workspace. Writes are serialized and atomic (temp file + rename). */
export class TaskStore {
  private file: TaskFile | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(workspaceId: string): Promise<WorkspaceTasks> {
    const file = await this.load();
    return file.workspaces[workspaceId] ?? EMPTY_WORKSPACE;
  }

  /** Applies `change` to the workspace's latest state and saves it. */
  update<Result>(
    workspaceId: string,
    change: (state: WorkspaceTasks) => { state: WorkspaceTasks; result: Result },
  ): Promise<{ state: WorkspaceTasks; result: Result }> {
    const run = async () => {
      const file = await this.load();
      const outcome = change(file.workspaces[workspaceId] ?? EMPTY_WORKSPACE);
      file.workspaces[workspaceId] = outcome.state;
      await this.save(file);
      return outcome;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Workspace ids whose auto-advance agent is `agentId`. */
  async workspacesWithAutoAgent(agentId: string): Promise<string[]> {
    const file = await this.load();
    return Object.entries(file.workspaces)
      .filter(([, state]) => state.autoAgentId === agentId)
      .map(([id]) => id);
  }

  private async load(): Promise<TaskFile> {
    if (this.file) return this.file;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.file = { version: 1, workspaces: {} };
      return this.file;
    }
    // Refuse to start from an empty list over a file we can't read: saving would wipe it.
    this.file = fileSchema.parse(JSON.parse(raw));
    return this.file;
  }

  private async save(file: TaskFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
