// CUSTOM(skills-loaded): reads what a Codex session has in its context from its rollout
// (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`). Codex sends the skill list as a
// developer message holding `<skills_instructions>`; it records nothing about MCP servers.

export interface CodexSkill {
  name: string;
  /** Empty when the line names the skill alone. */
  description: string;
  /** The skill root the `(file: rN/...)` reference points into, when the table lists it. */
  root: string | null;
}

const AVAILABLE_HEADING = "### Available skills";

/**
 * Pulls the skills text out of one rollout line, or null when the line has none. Codex writes it
 * as a `response_item` developer message, and newer rollouts also keep it in `world_state`.
 */
export function extractSkillsText(line: string): string | null {
  if (!line.includes(AVAILABLE_HEADING)) return null;
  let entry: { type?: unknown; payload?: unknown };
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return null;
  }
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  if (entry.type === "response_item" && Array.isArray(payload.content)) {
    for (const block of payload.content) {
      const text = (block as { text?: unknown } | null)?.text;
      if (typeof text === "string" && text.includes(AVAILABLE_HEADING)) return text;
    }
  }
  if (entry.type === "world_state") {
    const body = (payload.state as { host_skills?: { body?: unknown } } | undefined)?.host_skills?.body;
    if (typeof body === "string" && body.includes(AVAILABLE_HEADING)) return body;
  }
  return null;
}

/** Parses the `### Skill roots` table and the `### Available skills` list. */
export function parseCodexSkills(text: string): CodexSkill[] {
  const roots = new Map<string, string>();
  const skills: CodexSkill[] = [];
  let section: "roots" | "skills" | null = null;
  let current: CodexSkill | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      section = line === "### Skill roots" ? "roots" : line === AVAILABLE_HEADING ? "skills" : null;
      current = null;
      continue;
    }
    if (line.startsWith("</skills_instructions>") || line.startsWith("## ")) {
      section = null;
      current = null;
      continue;
    }
    if (section === "roots") {
      const match = /^- `([^`]+)` = `([^`]+)`$/.exec(line);
      if (match) roots.set(match[1]!, match[2]!);
      continue;
    }
    if (section !== "skills") continue;
    if (!line.startsWith("- ")) {
      if (current && line.trim()) current.description = `${current.description} ${line.trim()}`.trim();
      continue;
    }
    let rest = line.slice(2);
    let rootKey: string | null = null;
    const file = /\s*\(file: ([^)]*)\)$/.exec(rest);
    if (file) {
      rest = rest.slice(0, file.index);
      rootKey = file[1]!.split("/")[0] ?? null;
    }
    const split = rest.indexOf(": ");
    const name = (split < 0 ? rest : rest.slice(0, split)).replace(/:$/, "").trim();
    const description = split < 0 ? "" : rest.slice(split + 2).trim();
    current = { name, description, root: rootKey };
    skills.push(current);
  }

  return skills.map((skill) => ({
    ...skill,
    root: skill.root === null ? null : (roots.get(skill.root) ?? null),
  }));
}

/** The first line of a rollout: the thread id and the directory the session ran in. */
export function parseSessionMeta(line: string): { id: string; cwd: string } | null {
  try {
    const entry = JSON.parse(line) as { type?: unknown; payload?: { id?: unknown; cwd?: unknown } };
    if (entry.type !== "session_meta") return null;
    const { id, cwd } = entry.payload ?? {};
    return typeof id === "string" && typeof cwd === "string" ? { id, cwd } : null;
  } catch {
    return null;
  }
}

export interface CodexMcpServer {
  name: string;
  enabled: boolean;
}

/**
 * The `[mcp_servers.<name>]` tables of `config.toml`. Only what the panel needs: the names and
 * `enabled = false`. Subtables (`[mcp_servers.x.env]`) belong to their server.
 */
export function parseCodexMcpConfig(toml: string): CodexMcpServer[] {
  const servers: CodexMcpServer[] = [];
  let current: CodexMcpServer | null = null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const header = /^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]$/.exec(line);
      if (header) {
        current = { name: (header[1] ?? header[2])!, enabled: true };
        servers.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (current && /^enabled\s*=\s*false\b/.test(line)) current.enabled = false;
  }
  return servers;
}
