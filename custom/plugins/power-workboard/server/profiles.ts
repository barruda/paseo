// CUSTOM(agent-profiles): the profile of an orchestrator or of the Project Manager chat. The
// settings (skills, memory) are in the board store; the content is a Claude Code plugin folder:
//   <profiles>/<id>/.claude-plugin/plugin.json   {"name": "pwb-...", "description": "..."}
//   <profiles>/<id>/skills/<name>/SKILL.md       the profile's own skills
//   <profiles>/<id>/memory/                      Claude's auto-memory folder
//   <profiles>/<id>/system-prompt.md             appended to the agent's system prompt
// A folder is created lazily and never deleted by the plugin, not even with its orchestrator.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ASSISTANT_PROFILE,
  type ProfileView,
  type SkillSelection,
} from "../shared/profiles";
import { scanSkills } from "./profile-skills";

/** `<PASEO_HOME>/plugin-data/power-workboard/profiles`, next to the history folder. */
export function defaultProfilesDirectory(
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
    "profiles",
  );
}

/** `pwb-assistant`, or `pwb-<slug of the name, 30 chars at most>-<first 6 chars of the id>`. */
export function pluginNameFor(id: string, label: string): string {
  if (id === ASSISTANT_PROFILE) return "pwb-assistant";
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  const short = id
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  return ["pwb", slug || "orchestrator", short].filter(Boolean).join("-");
}

export interface ProfileRef {
  /** `assistant` or an orchestrator id. */
  id: string;
  /** The orchestrator's current name; only used to name the plugin when the folder is created. */
  label: string;
  /** The first `system-prompt.md`; orchestrators start empty. */
  seedPrompt?: string;
  /**
   * CUSTOM(factory): active mode reads the profile from the factory instead: `workers/<id>/` or
   * `pm/`, with the prompt from its `worker.md`. The plugin never writes the prompt there.
   */
  factory?: FactoryProfile;
}

/** CUSTOM(factory): a profile folder inside the factory. */
export interface FactoryProfile {
  directory: string;
  pluginName: string;
  systemPrompt: string;
}

/** CUSTOM(factory): the error a profile prompt edit gets in active mode. */
export const FACTORY_PROMPT_READ_ONLY =
  "This prompt comes from the factory; edit worker.md in the factory";

async function writeAtomic(file: string, text: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class Profiles {
  constructor(readonly root: string) {}

  directory(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
      throw new Error(`Invalid profile id: ${id}`);
    return path.join(this.root, id);
  }

  /** Creates the folder and its files when missing; changes nothing that exists. */
  async ensure(
    ref: ProfileRef,
  ): Promise<{ directory: string; pluginName: string }> {
    if (ref.factory) return ensureFactoryProfile(ref.factory); // CUSTOM(factory)
    const directory = this.directory(ref.id);
    await mkdir(path.join(directory, ".claude-plugin"), { recursive: true });
    await mkdir(path.join(directory, "skills"), { recursive: true });
    await mkdir(path.join(directory, "memory"), { recursive: true });
    const manifest = path.join(directory, ".claude-plugin", "plugin.json");
    let pluginName = "";
    try {
      const parsed = JSON.parse((await readText(manifest)) ?? "null") as {
        name?: unknown;
      } | null;
      if (typeof parsed?.name === "string") pluginName = parsed.name;
    } catch {
      // A broken manifest is written again below, with a fresh name.
    }
    if (!pluginName) {
      pluginName = pluginNameFor(ref.id, ref.label);
      await writeAtomic(
        manifest,
        `${JSON.stringify(
          {
            name: pluginName,
            description: `Workboard profile of ${ref.label}`,
          },
          null,
          2,
        )}\n`,
      );
    }
    try {
      await writeFile(
        path.join(directory, "system-prompt.md"),
        ref.seedPrompt ? `${ref.seedPrompt.trim()}\n` : "",
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return { directory, pluginName };
  }

  async read(ref: ProfileRef): Promise<ProfileView> {
    const { directory, pluginName } = await this.ensure(ref);
    const systemPrompt = ref.factory // CUSTOM(factory)
      ? ref.factory.systemPrompt
      : ((await readText(path.join(directory, "system-prompt.md"))) ?? "");
    const own = await scanSkills(path.join(directory, "skills"));
    return {
      directory,
      pluginName,
      systemPrompt,
      ownSkills: own.map((skill) => ({
        name: skill.folder,
        description: skill.description,
      })),
    };
  }

  async setSystemPrompt(ref: ProfileRef, text: string): Promise<void> {
    if (ref.factory) throw new Error(FACTORY_PROMPT_READ_ONLY); // CUSTOM(factory)
    const { directory } = await this.ensure(ref);
    await writeAtomic(path.join(directory, "system-prompt.md"), text);
  }
}

/**
 * CUSTOM(factory): the Claude plugin manifest and the memory folder of a factory profile. Both are
 * git-ignored in the factory (`.claude-plugin/`, `memory/`); nothing tracked is written.
 */
async function ensureFactoryProfile(
  profile: FactoryProfile,
): Promise<{ directory: string; pluginName: string }> {
  const { directory, pluginName } = profile;
  await mkdir(path.join(directory, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(directory, "memory"), { recursive: true });
  const manifest = path.join(directory, ".claude-plugin", "plugin.json");
  const text = `${JSON.stringify(
    {
      name: pluginName,
      description: `Workboard factory profile ${pluginName}`,
    },
    null,
    2,
  )}\n`;
  if ((await readText(manifest)) !== text) await writeAtomic(manifest, text);
  return { directory, pluginName };
}

export interface AgentProfile {
  systemPrompt?: string;
  providerOptions?: Record<string, unknown>;
}

/**
 * What a profile adds to an agent's creation. Only Claude takes the plugin, the skill allowlist
 * and the memory folder; any other provider gets the system prompt alone.
 */
export function buildAgentProfile(input: {
  provider: string;
  profile: Pick<ProfileView, "directory" | "pluginName" | "systemPrompt"> & {
    ownSkills: { name: string }[];
  };
  skills: SkillSelection;
  memory: boolean;
}): AgentProfile {
  const { profile } = input;
  const result: AgentProfile = {};
  const prompt = profile.systemPrompt.trim();
  if (prompt) result.systemPrompt = prompt;
  if (input.provider !== "claude" && !input.provider.startsWith("claude/"))
    return result;
  const options: Record<string, unknown> = {
    plugins: [{ type: "local", path: profile.directory }],
  };
  if (input.skills.mode === "selected")
    options.skills = [
      ...new Set([
        ...input.skills.names,
        ...profile.ownSkills.map(
          (skill) => `${profile.pluginName}:${skill.name}`,
        ),
      ]),
    ];
  if (input.memory)
    options.settings = {
      autoMemoryDirectory: path.join(profile.directory, "memory"),
    };
  result.providerOptions = options;
  return result;
}
