// CUSTOM(agent-profiles): lists the skills a Claude agent could load. The frontmatter reader and
// the folder scan are small copies of what custom/plugins/skills does (plugins do not import each
// other).
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SkillItem } from "../shared/profiles";

/** The leading `---` block of a SKILL.md: flat `key: value` pairs and `>` / `|` block scalars. */
export function parseFrontmatter(raw: string): Record<string, string> {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return {};
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end === -1) return {};
  const indented = (line: string) => /^[ \t]/.test(line);
  const unquote = (value: string) =>
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value.at(-1) === value[0]
      ? value.slice(1, -1)
      : value;
  const result: Record<string, string> = {};
  let index = 1;
  while (index < end) {
    const line = lines[index++]!;
    if (indented(line)) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (/^[>|][-+]?$/.test(rest)) {
      const block: string[] = [];
      while (index < end && (indented(lines[index]!) || !lines[index]!.trim()))
        block.push(lines[index++]!.trim());
      while (block.at(-1) === "") block.pop();
      result[key] =
        rest[0] === ">" ? block.filter(Boolean).join(" ") : block.join("\n");
    } else result[key] = unquote(rest);
  }
  return result;
}

export interface FoundSkill {
  /** The folder name, which is what a plugin's skill is called. */
  folder: string;
  /** The frontmatter name, when it has one. */
  declared: string;
  description: string;
  file: string;
}

/** Every `<root>/<folder>/SKILL.md` that can be read; anything else is skipped. */
export async function scanSkills(root: string): Promise<FoundSkill[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: FoundSkill[] = [];
  for (const entry of entries) {
    // `isDirectory()` is false for a symlink to a folder, which personal skills often are.
    if (entry.name.startsWith(".")) continue;
    const file = path.join(root, entry.name, "SKILL.md");
    try {
      const front = parseFrontmatter(await readFile(file, "utf8"));
      found.push({
        folder: entry.name,
        declared: front.name?.trim() ?? "",
        description: front.description?.trim() ?? "",
        file,
      });
    } catch {
      // Not a skill folder, or unreadable.
    }
  }
  return found.sort((a, b) => a.folder.localeCompare(b.folder));
}

export interface SkillRoots {
  /** `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  claudeHome: string;
  /** `~/.agents`. */
  agentsHome: string;
}
export function defaultSkillRoots(
  env: NodeJS.ProcessEnv = process.env,
): SkillRoots {
  return {
    claudeHome: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    agentsHome: path.join(os.homedir(), ".agents"),
  };
}

async function pluginName(installPath: string, fallback: string) {
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(installPath, ".claude-plugin", "plugin.json"),
        "utf8",
      ),
    ) as { name?: unknown };
    if (typeof manifest.name === "string" && manifest.name.trim())
      return manifest.name.trim();
  } catch {
    // Use the install key's name.
  }
  return fallback;
}

/** Skills of the Claude Code plugins installed under `<claudeHome>/plugins`. */
async function installedPluginSkills(claudeHome: string): Promise<SkillItem[]> {
  let plugins: Record<string, unknown>;
  try {
    const parsed = JSON.parse(
      await readFile(
        path.join(claudeHome, "plugins", "installed_plugins.json"),
        "utf8",
      ),
    ) as { plugins?: Record<string, unknown> } | null;
    plugins = parsed?.plugins ?? {};
  } catch {
    return [];
  }
  const items: SkillItem[] = [];
  const seen = new Set<string>();
  for (const [key, installs] of Object.entries(plugins)) {
    if (!Array.isArray(installs)) continue;
    for (const install of installs as { installPath?: unknown }[]) {
      if (typeof install?.installPath !== "string") continue;
      const name = await pluginName(install.installPath, key.split("@")[0]!);
      for (const skill of await scanSkills(
        path.join(install.installPath, "skills"),
      )) {
        const qualified = `${name}:${skill.folder}`;
        if (seen.has(qualified)) continue;
        seen.add(qualified);
        items.push({
          name: qualified,
          description: skill.description,
          group: "plugins",
          source: skill.file,
        });
      }
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** The profile's own skills, qualified with its plugin name, then personal, then plugin skills. */
export async function listSkills(input: {
  profileDirectory: string;
  pluginName: string;
  roots?: SkillRoots;
}): Promise<SkillItem[]> {
  const roots = input.roots ?? defaultSkillRoots();
  const [own, claude, agents, plugins] = await Promise.all([
    scanSkills(path.join(input.profileDirectory, "skills")),
    scanSkills(path.join(roots.claudeHome, "skills")),
    scanSkills(path.join(roots.agentsHome, "skills")),
    installedPluginSkills(roots.claudeHome),
  ]);
  const personal = new Map<string, SkillItem>();
  for (const skill of [...claude, ...agents]) {
    const name = skill.declared || skill.folder;
    if (!personal.has(name))
      personal.set(name, {
        name,
        description: skill.description,
        group: "personal",
        source: skill.file,
      });
  }
  return [
    ...own.map((skill) => ({
      name: `${input.pluginName}:${skill.folder}`,
      description: skill.description,
      group: "profile" as const,
      source: skill.file,
    })),
    ...[...personal.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...plugins,
  ];
}
