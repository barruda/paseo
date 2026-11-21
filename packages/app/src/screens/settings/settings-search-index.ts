// CUSTOM(settings-filter): Search terms for each settings page. Update when a page gains or loses a
// setting. `i18nKeys` are i18n keys or key prefixes (resolved with the current language, nested
// strings flattened); `terms` are English literals the page renders without i18n.
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";

export interface SettingsSearchEntry {
  i18nKeys?: string[];
  terms?: string[];
}

export const SETTINGS_SEARCH_INDEX: Partial<
  Record<SettingsSectionSlug | HostSectionSlug, SettingsSearchEntry>
> = {
  // ---- App ------------------------------------------------------------------------------------
  // GeneralSection (language) + SendingSection + OpenLocationSection.
  general: {
    i18nKeys: [
      "settings.general.language",
      "settings.general.defaultSend",
      "settings.general.sendShortcut",
      "settings.general.sending",
      "settings.general.serviceUrls",
      "settings.layout.openInSidePane",
    ],
  },
  appearance: {
    i18nKeys: [
      "settings.appearance.theme",
      "settings.appearance.fonts",
      "settings.appearance.layout",
      "settings.appearance.syntax",
    ],
  },
  sidebar: { i18nKeys: ["settings.appearance.sidebar"] },
  chat: {
    i18nKeys: [
      "settings.appearance.chatOutline",
      "settings.appearance.detailLevel",
      "settings.general.autoExpandReasoning",
      "settings.general.chatDisplay",
    ],
  },
  terminal: { i18nKeys: ["settings.general.terminalScrollback"] },
  browser: { i18nKeys: ["settings.general.browserData"] },
  editor: { i18nKeys: ["settings.editor"] },
  files: { i18nKeys: ["settings.files"] },
  shortcuts: { i18nKeys: ["settings.shortcuts", "settings.shortcutFile"] },
  integrations: { i18nKeys: ["settings.integrations"] },
  notifications: { i18nKeys: ["settings.notifications"] },
  permissions: { i18nKeys: ["settings.permissions"] },
  diagnostics: { i18nKeys: ["settings.diagnostics"] },
  about: { i18nKeys: ["settings.about", "changelog.title"] },

  // ---- Bruno's Customizations -----------------------------------------------------------------
  "customizations-composer": {
    terms: [
      "Jev router",
      "Router settings",
      "Model focused",
      "Effort focused",
      "TypeSafe provider",
      "API key",
      "Test router",
      "Delegation",
      "Delegation settings",
      "Implementer model and effort",
    ],
  },
  "customizations-chat": {
    terms: ["Beside the chat", "Link list", "Show the links the agent sent beside the chat"],
  },
  "customizations-chat-options": {
    terms: [
      "Above chat",
      "Inside left",
      "Inside right",
      "Parent agent",
      "Tasks",
      "Subagents",
      "Background tools",
      "Commit",
      "Rename session",
      "Skills/MCPs",
      "Tell agent",
      "TokenLedger",
      "Changes",
      "Worktree",
      "Git sync",
      "Reading mode",
      "Attachments",
      "Model",
      "Effort",
      "Agent permissions",
      "Fast mode",
      "Plan mode",
      "Other agent features",
      "Model shortcut",
      "Keep cache warm",
      "Critic",
      "Jev router",
      "Delegation",
      "Git branch",
      "Project icon",
      "Context usage",
      "Dictation",
      "Voice mode",
      "Send message",
      "Stop agent",
    ],
  },
  "customizations-tabs": {
    terms: [
      "Tasks mode tabs",
      "Flexible tab movement",
      "Preview tabs",
      "Skip pinned tabs",
      "Last visited tab shortcut",
      "Header shortcuts",
      // CUSTOM(explorer-lock)
      "Right sidebar",
      "Keep the right sidebar open or closed",
      "Barra lateral direita",
    ],
  },
  "customizations-voice": { i18nKeys: ["settings.voiceSettings", "settings.voice"] },
  // CUSTOM(idle-cleanup-period)
  "customizations-agents": {
    terms: ["Release idle agents after", "Idle agent release", "Idle period"],
  },
  "customizations-github": {
    terms: ["GitHub account", "Signed in as", "gh config directory", "GH_CONFIG_DIR", "Refresh"],
  },
  // CUSTOM(projects-assistant)
  "customizations-projects-assistant": {
    terms: [
      "Project Manager",
      "Default action",
      "Prepare PR",
      "Observe only",
      "Check command",
      "Auto-fix attempts",
      "Base branch",
      "Compact at (tokens)", // CUSTOM(assistant-compact)
    ],
  },
  "customizations-config-file": {
    terms: [
      "Configuration file",
      "Skip providers and API keys",
      "Save configuration",
      "Load configuration",
    ],
  },

  // ---- Host -----------------------------------------------------------------------------------
  // HostSettingsPage: badges, appearance (name, color, badge), local daemon, update, restart, remove.
  host: {
    i18nKeys: [
      "settings.host.badges",
      "settings.host.appearance",
      "settings.host.daemon",
      "settings.host.password",
      "desktop.daemon",
    ],
  },
  projects: { i18nKeys: ["settings.projectList"], terms: ["Project path", "Repository"] },
  // HostConnectionsPage.
  connections: { i18nKeys: ["settings.host.connections"] },
  "pair-device": { i18nKeys: ["settings.host.pairDevices"] },
  // HostAgentsPage: orchestration cards, browser tools, idle cleanup, skills, agent profiles.
  agents: {
    i18nKeys: [
      "settings.host.orchestration",
      "settings.host.agents",
      "settings.host.skills",
      "settings.host.agentProfiles",
    ],
    terms: ["Browser tools"],
  },
  metadata: { i18nKeys: ["settings.metadataGeneration"] },
  voice: { i18nKeys: ["settings.voiceSettings", "settings.voice"] },
  // HostWorkspacesPage.
  workspaces: {
    i18nKeys: ["settings.host.workspaces"],
    terms: [
      "Archive merged PR workspaces",
      "Automatically archive clean Paseo workspaces after their pull request is merged",
    ],
  },
  providers: { i18nKeys: ["settings.providers"] },
  usage: { i18nKeys: ["providerUsage"] },
  // HostTerminalsPage.
  terminals: {
    i18nKeys: ["settings.host.terminalProfiles"],
    terms: [
      "Terminal agents",
      "Enable terminal agent hooks",
      "Get notifications and status from terminal agents",
    ],
  },
  plugins: { i18nKeys: ["settings.plugins"] },
};

const MAX_TERM_LENGTH = 120;
const ACCESSIBILITY_KEY = /accessibility/i;

/** Flatten a (possibly nested) i18n value into its leaf strings, skipping accessibility labels. */
function collectStrings(value: unknown, key: string, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      if (ACCESSIBILITY_KEY.test(childKey)) continue;
      collectStrings(child, `${key}.${childKey}`, out);
    }
  }
}

export function resolveSearchTerms(
  entry: SettingsSearchEntry | undefined,
  translate: (key: string, options: { returnObjects: true }) => unknown,
): string[] {
  if (!entry) return [];
  const raw: string[] = [...(entry.terms ?? [])];
  for (const key of entry.i18nKeys ?? []) {
    const resolved = translate(key, { returnObjects: true });
    if (resolved === key) continue; // missing key: i18next echoes the key back
    collectStrings(resolved, key, raw);
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const text of raw) {
    const cleaned = text
      .replace(/\{\{[^}]*\}\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned || cleaned.length > MAX_TERM_LENGTH || seen.has(cleaned)) continue;
    seen.add(cleaned);
    terms.push(cleaned);
  }
  return terms;
}
