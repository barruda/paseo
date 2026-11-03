import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type CriticConfig,
  CriticConfigSchema,
  DEFAULT_CRITIC_CONFIG,
} from "@getpaseo/protocol/critic";
import { z } from "zod";

// Each agent's critic config, the default for agents without one, and the persistent critic of
// each agent, in one JSON file under PASEO_HOME. Images live inline (base64), so the file can be
// a few MB; it is only read at start and written on change.

const AgentEntrySchema = z.object({
  config: CriticConfigSchema,
  persistentCriticAgentId: z.string().nullable(),
});

const StoreFileSchema = z.object({
  version: z.literal(1),
  defaults: CriticConfigSchema,
  agents: z.record(z.string(), AgentEntrySchema),
});
type StoreFile = z.infer<typeof StoreFileSchema>;

export function defaultStoreFile(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.join(home, "custom-critic.json");
}

export class CriticStore {
  private data: StoreFile | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async load(): Promise<StoreFile> {
    if (this.data) return this.data;
    try {
      const parsed = StoreFileSchema.safeParse(JSON.parse(await readFile(this.file, "utf8")));
      if (parsed.success) {
        this.data = parsed.data;
        return this.data;
      }
      console.error(`[critic] ignoring invalid ${this.file}: ${parsed.error.message}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.data = { version: 1, defaults: DEFAULT_CRITIC_CONFIG, agents: {} };
    return this.data;
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    // A failed write must not block the ones after it.
    this.writes = this.writes.catch(() => undefined).then(() => this.write(snapshot));
    return this.writes;
  }

  private async write(snapshot: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, snapshot, "utf8");
    await rename(temp, this.file);
  }

  async get(agentId: string): Promise<{ config: CriticConfig; isDefault: boolean }> {
    const data = await this.load();
    const entry = data.agents[agentId];
    if (entry) return { config: entry.config, isDefault: false };
    return { config: { ...data.defaults, enabled: false }, isDefault: true };
  }

  async set(input: { agentId: string; config: CriticConfig; saveAsDefault: boolean }) {
    const data = await this.load();
    const previous = data.agents[input.agentId];
    data.agents[input.agentId] = {
      config: input.config,
      persistentCriticAgentId: previous?.persistentCriticAgentId ?? null,
    };
    if (input.saveAsDefault) data.defaults = { ...input.config, enabled: false };
    await this.save();
  }

  async persistentCritic(agentId: string): Promise<string | null> {
    return (await this.load()).agents[agentId]?.persistentCriticAgentId ?? null;
  }

  async setPersistentCritic(agentId: string, criticAgentId: string | null): Promise<void> {
    const data = await this.load();
    const entry = data.agents[agentId];
    if (!entry) return;
    entry.persistentCriticAgentId = criticAgentId;
    await this.save();
  }

  /** True for an agent some reviewed agent keeps as its persistent critic. */
  async isPersistentCritic(agentId: string): Promise<boolean> {
    const data = await this.load();
    return Object.values(data.agents).some((entry) => entry.persistentCriticAgentId === agentId);
  }
}
