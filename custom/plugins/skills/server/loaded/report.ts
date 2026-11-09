// CUSTOM(skills-loaded): turns what a session file says into the rows the "Skills and MCPs
// Loaded" tab shows. Pure, so the tests cover it without files.

import path from "node:path";

import type { ClaudeContextState } from "./claude.ts";
import { mcpServerOfTool, normalizeServerName } from "./claude.ts";
import type { CodexMcpServer, CodexSkill } from "./codex.ts";

export type LoadedSkillCategory = "custom" | "plugin" | "bundled";
export type LoadedSkillGroup = "custom" | "described" | "name-only";

export interface LoadedSkill {
  name: string;
  description: string;
  hasDescription: boolean;
  category: LoadedSkillCategory;
  group: LoadedSkillGroup;
}

export type McpStatus = "loaded" | "needs-auth" | "pending" | "failed" | "configured" | "disabled";

export interface LoadedMcpServer {
  name: string;
  status: McpStatus;
  error: string | null;
  toolCount: number | null;
  fullSchemaCount: number | null;
  instructions: boolean | null;
}

const GROUP_ORDER: readonly LoadedSkillGroup[] = ["custom", "described", "name-only"];

/** Your own skills first, then the others with a description, then name-only; A-Z within. */
export function buildSkillRows(
  skills: ReadonlyArray<{ name: string; description: string; category: LoadedSkillCategory }>,
): LoadedSkill[] {
  return skills
    .map((skill): LoadedSkill => {
      const hasDescription = skill.description.trim().length > 0;
      const group: LoadedSkillGroup =
        skill.category === "custom" ? "custom" : hasDescription ? "described" : "name-only";
      return { ...skill, hasDescription, group };
    })
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

/**
 * Claude lists no paths. A skill is the user's own when its name is in one of the user's skill
 * folders; a `plugin:skill` name is a plugin's; the rest ship with Claude Code.
 */
export function categorizeClaudeSkill(name: string, customNames: ReadonlySet<string>): LoadedSkillCategory {
  if (customNames.has(name)) return "custom";
  if (name.includes(":")) return "plugin";
  return "bundled";
}

/**
 * Codex lists each skill's root. `.system` holds the skills Codex installs itself, and plugin
 * skills live in its plugin cache with a `plugin:skill` name.
 */
export function categorizeCodexSkill(skill: CodexSkill, codexHome: string): LoadedSkillCategory {
  if (skill.name.includes(":")) return "plugin";
  const root = skill.root ?? "";
  if (root.split(path.sep).includes(".system")) return "bundled";
  if (root && isInside(root, path.join(codexHome, "plugins"))) return "plugin";
  return "custom";
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const STATUS_ORDER: readonly McpStatus[] = ["loaded", "pending", "needs-auth", "failed", "configured", "disabled"];

function sortServers(servers: LoadedMcpServer[]): LoadedMcpServer[] {
  return servers.sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Groups the session's MCP tools by server. Tool names carry the server name normalized
 * (`claude.ai Notion` → `claude_ai_Notion`), while the server lists and instructions use the
 * display name, so both are matched on the normalized form and shown with the display name.
 */
export function summarizeClaudeMcp(state: ClaudeContextState): LoadedMcpServer[] {
  interface Entry {
    name: string;
    tools: number;
    full: number;
    instructions: boolean;
    status: McpStatus;
    error: string | null;
  }
  const byKey = new Map<string, Entry>();
  const entry = (key: string): Entry => {
    let found = byKey.get(key);
    if (!found) {
      const name = state.serverNames.get(key) ?? key;
      found = { name, tools: 0, full: 0, instructions: false, status: "loaded", error: null };
      byKey.set(key, found);
    }
    return found;
  };

  for (const tool of state.tools) {
    const server = mcpServerOfTool(tool);
    if (!server) continue;
    const found = entry(server);
    found.tools += 1;
    if (state.fullSchemaTools.has(tool)) found.full += 1;
  }
  for (const name of state.instructions) entry(normalizeServerName(name)).instructions = true;
  for (const name of state.pending) entry(normalizeServerName(name)).status = "pending";
  for (const name of state.needsAuth) entry(normalizeServerName(name)).status = "needs-auth";
  for (const { name, error } of state.failed) {
    const found = entry(normalizeServerName(name));
    found.status = "failed";
    found.error = error;
  }

  return sortServers(
    [...byKey.values()].map((found) => ({
      name: found.name,
      status: found.status,
      error: found.error,
      toolCount: found.tools,
      fullSchemaCount: found.full,
      instructions: found.instructions,
    })),
  );
}

/** Codex records no MCP state in the rollout, so its servers come from config.toml. */
export function summarizeCodexMcp(servers: readonly CodexMcpServer[]): LoadedMcpServer[] {
  return sortServers(
    servers.map((server) => ({
      name: server.name,
      status: server.enabled ? "configured" : "disabled",
      error: null,
      toolCount: null,
      fullSchemaCount: null,
      instructions: null,
    })),
  );
}
