// CUSTOM(skills-loaded): reads what a Claude Code session has in its context from the session's
// transcript (`<config dir>/projects/<project>/<sessionId>.jsonl`). Claude Code records each change
// to the context as an `attachment` line; this replays them in order.

export interface ParsedSkill {
  name: string;
  /** Empty when Claude Code listed the name alone to fit its skill budget. */
  description: string;
}

export interface FailedServer {
  name: string;
  error: string | null;
}

export interface ClaudeContextState {
  skills: Map<string, ParsedSkill>;
  /** Every tool known by name (deferred tools and those whose schema is loaded). */
  tools: Set<string>;
  /** Tools whose full schema is in context: surfaced by Claude Code or loaded by ToolSearch. */
  fullSchemaTools: Set<string>;
  /** Display names of the MCP servers whose instructions are in context. */
  instructions: Set<string>;
  needsAuth: string[];
  pending: string[];
  failed: FailedServer[];
  /** Normalized server name → the display name last seen for it. Survives compaction. */
  serverNames: Map<string, string>;
  sawSkillListing: boolean;
  sawToolDelta: boolean;
}

export function createClaudeState(): ClaudeContextState {
  return {
    skills: new Map(),
    tools: new Set(),
    fullSchemaTools: new Set(),
    instructions: new Set(),
    needsAuth: [],
    pending: [],
    failed: [],
    serverNames: new Map(),
    sawSkillListing: false,
    sawToolDelta: false,
  };
}

function resetContext(state: ClaudeContextState): void {
  state.skills.clear();
  state.tools.clear();
  state.fullSchemaTools.clear();
  state.instructions.clear();
}

/**
 * Splits a `skill_listing` body into skills. Each entry is `- name: description` or `- name`;
 * a description can run over several lines. Names may contain `:` (`plugin:skill`), so the
 * known names from the attachment decide where an entry starts, longest first. Without names
 * (older transcripts) an entry is split at its first `": "`.
 */
export function parseSkillListingContent(content: string, names: readonly string[]): ParsedSkill[] {
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const entries: ParsedSkill[] = [];
  let current: ParsedSkill | null = null;

  const startEntry = (line: string): ParsedSkill | null => {
    if (!line.startsWith("- ")) return null;
    const rest = line.slice(2);
    for (const name of byLength) {
      if (rest === name || rest === `${name}:`) return { name, description: "" };
      if (rest.startsWith(`${name}: `)) return { name, description: rest.slice(name.length + 2) };
    }
    if (names.length > 0) return null;
    const split = rest.indexOf(": ");
    if (split < 0) return { name: rest.trim(), description: "" };
    return { name: rest.slice(0, split), description: rest.slice(split + 2) };
  };

  for (const line of content.split("\n")) {
    const started = startEntry(line);
    if (started) {
      current = started;
      entries.push(started);
    } else if (current && line.trim().length > 0) {
      current.description = current.description ? `${current.description}\n${line}` : line;
    }
  }

  const listed = new Set(entries.map((entry) => entry.name));
  for (const name of names) {
    if (!listed.has(name)) entries.push({ name, description: "" });
  }
  for (const entry of entries) entry.description = entry.description.trim();
  return entries;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function failedList(value: unknown): FailedServer[] | null {
  if (!Array.isArray(value)) return null;
  const result: FailedServer[] = [];
  for (const item of value) {
    if (typeof item === "string") result.push({ name: item, error: null });
    else if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
      const { name, error } = item as { name: string; error?: unknown };
      result.push({ name, error: typeof error === "string" ? error : null });
    }
  }
  return result;
}

/** `## <server name>` opens each block of an `mcp_instructions_delta`. */
function blockServerName(block: unknown): string | null {
  if (typeof block !== "string") return null;
  const match = /^## (.+)$/m.exec(block);
  return match ? match[1]!.trim() : null;
}

function rememberNames(state: ClaudeContextState, names: Iterable<string>): void {
  for (const name of names) state.serverNames.set(normalizeServerName(name), name);
}

type Attachment = Record<string, unknown> & { type?: unknown };

function applyAttachment(state: ClaudeContextState, attachment: Attachment): void {
  switch (attachment.type) {
    case "skill_listing": {
      // An initial listing is the whole list again (a new session or after compaction).
      if (attachment.isInitial === true) state.skills.clear();
      state.sawSkillListing = true;
      const content = typeof attachment.content === "string" ? attachment.content : "";
      const names = stringList(attachment.names) ?? [];
      for (const skill of parseSkillListingContent(content, names)) state.skills.set(skill.name, skill);
      return;
    }
    case "deferred_tools_delta": {
      state.sawToolDelta = true;
      for (const name of stringList(attachment.addedNames) ?? []) state.tools.add(name);
      for (const name of stringList(attachment.readdedNames) ?? []) state.tools.add(name);
      for (const name of stringList(attachment.removedNames) ?? []) {
        state.tools.delete(name);
        state.fullSchemaTools.delete(name);
      }
      for (const name of stringList(attachment.surfacedNames) ?? []) {
        state.tools.add(name);
        state.fullSchemaTools.add(name);
      }
      // The server lists are the current state on every delta, not changes.
      state.needsAuth = stringList(attachment.needsAuthMcpServers) ?? state.needsAuth;
      state.pending = stringList(attachment.pendingMcpServers) ?? state.pending;
      state.failed = failedList(attachment.failedMcpServers) ?? state.failed;
      rememberNames(state, [...state.needsAuth, ...state.pending, ...state.failed.map((server) => server.name)]);
      return;
    }
    case "mcp_instructions_delta": {
      const added = stringList(attachment.addedNames) ?? [];
      // Older transcripts leave `addedNames` empty and only carry the blocks.
      const fromBlocks = Array.isArray(attachment.addedBlocks)
        ? attachment.addedBlocks.map(blockServerName).filter((name): name is string => name !== null)
        : [];
      for (const name of added.length > 0 ? added : fromBlocks) state.instructions.add(name);
      rememberNames(state, state.instructions);
      for (const name of stringList(attachment.removedNames) ?? []) state.instructions.delete(name);
      return;
    }
    default:
      return;
  }
}

/** ToolSearch answers with `tool_reference` blocks; each one loads that tool's full schema. */
function applyToolReferences(state: ClaudeContextState, message: unknown): void {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const inner = (block as { type?: unknown; content?: unknown } | null);
    if (inner?.type !== "tool_result" || !Array.isArray(inner.content)) continue;
    for (const ref of inner.content) {
      const { type, tool_name: toolName } = (ref ?? {}) as { type?: unknown; tool_name?: unknown };
      if (type === "tool_reference" && typeof toolName === "string") {
        state.tools.add(toolName);
        state.fullSchemaTools.add(toolName);
      }
    }
  }
}

export interface ApplyOptions {
  /**
   * Count tools the agent loaded with ToolSearch. Off when reading another session to
   * predict a new one, which starts without them.
   */
  includeToolSearch: boolean;
}

/** Applies one transcript line. Cheap for the lines that don't matter: no JSON parse. */
export function applyClaudeLine(state: ClaudeContextState, line: string, options: ApplyOptions): void {
  const isAttachment = line.includes('"attachment"');
  const isCompact = line.includes('"compact_boundary"');
  const isToolRef = options.includeToolSearch && line.includes('"tool_reference"');
  if (!isAttachment && !isCompact && !isToolRef) return;

  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (entry.type === "system" && entry.subtype === "compact_boundary") {
    // Compaction drops everything; Claude Code re-sends the listings right after.
    resetContext(state);
    return;
  }
  if (entry.type === "attachment" && entry.attachment && typeof entry.attachment === "object") {
    applyAttachment(state, entry.attachment as Attachment);
    return;
  }
  if (isToolRef && entry.type === "user") applyToolReferences(state, entry.message);
}

export function parseClaudeTranscript(lines: Iterable<string>, options: ApplyOptions): ClaudeContextState {
  const state = createClaudeState();
  for (const line of lines) applyClaudeLine(state, line, options);
  return state;
}

/** Claude Code's MCP tool names use the server name with every other character turned into `_`. */
export function normalizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** `mcp__<server>__<tool>` → `<server>`; null for a non-MCP tool. */
export function mcpServerOfTool(tool: string): string | null {
  if (!tool.startsWith("mcp__")) return null;
  const rest = tool.slice(5);
  const split = rest.indexOf("__");
  return split > 0 ? rest.slice(0, split) : null;
}
