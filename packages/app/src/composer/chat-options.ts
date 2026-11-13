// CUSTOM(chat-options): stable keys for the composer rail, including plugin-contributed pills.
export const CHAT_OPTIONS = [
  ["parent", "Parent agent"],
  ["tasks", "Tasks"],
  ["subagents", "Subagents"],
  ["plugin:tldr:tldr", "TLDR"],
  ["commit", "Commit: wip"],
  ["rename", "Rename session"],
  ["plugin:skills:skills", "Skills/MCPs"],
  ["plugin:tell-agent:message-agent", "Tell agent"],
  ["plugin:token-ledger:ledger-pill", "TokenLedger"],
  ["diff", "Changes"],
  ["worktree", "Worktree"],
  ["git-sync", "Git sync"],
  ["reading", "Reading mode"],
  ["mode", "Agent permissions"],
  ["feature:fast_mode", "Fast mode"],
  ["feature:plan_mode", "Plan mode"],
  ["feature:other", "Other agent features"],
  ["model-shortcut", "Model shortcut (Ctrl+M)"],
  ["cache-warmup", "Keep cache warm"],
  ["critic", "Critic"],
  ["jev", "Jev router"],
  ["delegation", "Delegation"],
  ["branch", "Git branch"],
  ["project", "Project icon"],
  ["context-meter", "Context usage"],
  ["dictation", "Dictation"],
  ["voice", "Voice mode"],
  ["send", "Send message"],
  ["stop", "Stop agent"],
] as const;

export function featureChatOptionKey(id: string): string {
  return id === "fast_mode" || id === "plan_mode" ? `feature:${id}` : "feature:other";
}

export function pluginChatOptionKey(pluginId: string, id: string, agentId: string): string {
  const suffix = `-${agentId}`;
  return `plugin:${pluginId}:${id.endsWith(suffix) ? id.slice(0, -suffix.length) : id}`;
}

export function chatOptionEnabled(options: Record<string, boolean>, key: string): boolean {
  return options[key] !== false;
}

// CUSTOM(chat-options): the composer rail is three groups. Each group's movable items can be
// reordered in Settings > Bruno's Customizations > Chat Options (`chatOptionOrder`).
export type ChatOptionGroup = "above" | "left" | "right";

export const CHAT_OPTION_GROUPS: readonly ChatOptionGroup[] = ["above", "left", "right"];

const MOVABLE_CHAT_OPTIONS: Record<ChatOptionGroup, readonly string[]> = {
  above: [
    "parent",
    "tasks",
    "subagents",
    "plugin:tldr:tldr",
    "commit",
    "rename",
    "plugin:skills:skills",
    "plugin:tell-agent:message-agent",
    "plugin:token-ledger:ledger-pill",
    "diff",
    "worktree",
    "git-sync",
    "reading",
  ],
  left: ["model-shortcut", "cache-warmup", "critic", "jev", "delegation"],
  right: ["project", "context-meter", "dictation", "voice"],
};

/** Not draggable: the left ones live inside the model/mode control, the right ones are drawn last. */
const FIXED_CHAT_OPTIONS: Record<
  ChatOptionGroup,
  { before: readonly string[]; after: readonly string[] }
> = {
  above: { before: [], after: [] },
  left: { before: ["mode", "feature:fast_mode", "feature:plan_mode", "feature:other"], after: [] },
  right: { before: [], after: ["branch", "send", "stop"] },
};

export const FIXED_CHAT_OPTION_HINTS: Record<string, string> = {
  branch: "Shown inside the project icon",
  stop: "Takes the place of Send while the agent runs",
};

/** Movable keys of a group in default order. */
export function movableChatOptions(group: ChatOptionGroup): readonly string[] {
  return MOVABLE_CHAT_OPTIONS[group];
}

export function fixedChatOptions(group: ChatOptionGroup): {
  before: readonly string[];
  after: readonly string[];
} {
  return FIXED_CHAT_OPTIONS[group];
}

/** The last default-order plugin key: any other `plugin:*` key is inserted right after it. */
const LAST_DEFAULT_PLUGIN_KEY = "plugin:token-ledger:ledger-pill";

/** Default position of a key for the "above" group; unknown plugin keys go after the last plugin. */
export function defaultAboveOrder(extraPluginKeys: readonly string[]): string[] {
  const keys = [...MOVABLE_CHAT_OPTIONS.above];
  const at = keys.indexOf(LAST_DEFAULT_PLUGIN_KEY) + 1;
  keys.splice(at, 0, ...extraPluginKeys.filter((key) => !keys.includes(key)));
  return keys;
}

/**
 * `keys` come in default order. The result starts with the saved keys that are present (in saved
 * order); every key missing from `saved` goes right after its nearest default-order predecessor
 * that is already in the result, or at the start.
 */
export function orderChatOptions(
  keys: readonly string[],
  saved: readonly string[] | undefined,
): string[] {
  const present = new Set(keys);
  const result: string[] = [];
  for (const key of saved ?? []) {
    if (present.has(key) && !result.includes(key)) result.push(key);
  }
  keys.forEach((key, index) => {
    if (result.includes(key)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i -= 1) {
      const predecessor = result.indexOf(keys[i]);
      if (predecessor !== -1) {
        at = predecessor + 1;
        break;
      }
    }
    result.splice(at, 0, key);
  });
  return result;
}
