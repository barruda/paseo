// CUSTOM(bruno-config-file): gathers and applies every Bruno's Customizations setting for the
// Save and Load page. Each section is applied on its own: one failure does not stop the rest.
import { useCallback, useMemo, useState } from "react";
import { settingsRpc } from "@getpaseo/plugin";
import { DELEGATION_PLUGIN_ID, DELEGATION_SETTINGS_ID } from "@getpaseo/protocol/delegation";
import { JEV_ROUTER_PLUGIN_ID, JEV_ROUTER_SETTINGS_ID } from "@getpaseo/protocol/jev-router";
import {
  MutableDaemonConfigPatchSchema,
  type MutableDaemonConfigPatch,
} from "@getpaseo/protocol/messages";
import { getIsElectron } from "@/constants/platform";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAppSettings } from "@/hooks/use-settings";
import { downloadTextFile, pickTextFile } from "@/keyboard/shortcut-file-io";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import { useInstalledPlugin } from "@/plugins/registry";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import {
  BRUNO_CONFIG_ERROR_MESSAGES,
  BRUNO_CONFIG_FILE_NAME,
  parseBrunoConfig,
  serializeBrunoConfig,
  type BrunoConfig,
  type BrunoConfigSnapshot,
  type JsonValue,
} from "./config-file";

export interface LoadReport {
  /** Set when the file was refused or never read; the lists below are then empty. */
  refused: string | null;
  applied: string[];
  skipped: string[];
  failed: { section: string; error: string }[];
}

export interface PreparedLoad {
  config: BrunoConfig;
  sections: string[];
}

const DAEMON_SECTIONS = [
  ["GitHub account", "github"],
  ["Voice and dictation: speech", "speech"],
  ["Voice and dictation: features", "features"],
] as const;

type AppUpdate = Parameters<ReturnType<typeof useAppSettings>["updateSettings"]>[0];

const APP_KEYS = [
  "chatLinksEnabled",
  "chatOptions",
  "chatOptionOrder",
  "deskPreviewTabs",
  "recentTabsSkipPinned",
  "showCriticToggle",
  "showJevRouterToggle",
] as const;

interface PluginTarget {
  label: string;
  pluginId: string;
  settingsId: string;
  plugin: InstalledPlugin | null;
}

async function readPluginValues(plugin: InstalledPlugin, settingsId: string): Promise<JsonValue> {
  const rpc = settingsRpc(settingsId);
  const result = rpc.read.output.parse(await plugin.invoke(rpc.read.name, {}));
  if (result.status !== "ready") throw new Error(result.error);
  return result.values;
}

async function writePluginValues(
  plugin: InstalledPlugin,
  settingsId: string,
  values: JsonValue,
): Promise<void> {
  const rpc = settingsRpc(settingsId);
  // An invalid stored document still has a revision to overwrite.
  const current = rpc.read.output.parse(await plugin.invoke(rpc.read.name, {}));
  const result = rpc.write.output.parse(
    await plugin.invoke(rpc.write.name, { revision: current.revision, values }),
  );
  if (result.status !== "saved") throw new Error(result.error);
  plugin.queryClient.setQueryData(pluginSettingsKey(settingsId), { ...result, status: "ready" });
}

interface Task {
  section: string;
  work: () => Promise<void>;
}

/** The host writes a load needs: daemon config patches and plugin documents. */
function hostTasks(input: {
  host: BrunoConfig["host"];
  serverId: string | null;
  targets: PluginTarget[];
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
  skipped: string[];
}): Task[] {
  const { host, serverId, targets, patchConfig, skipped } = input;
  if (!serverId) return [];
  const tasks: Task[] = [];
  for (const [section, key] of DAEMON_SECTIONS) {
    const value = host?.[key];
    if (value) {
      tasks.push({
        section,
        work: async () => {
          await patchConfig(MutableDaemonConfigPatchSchema.parse({ [key]: value }));
        },
      });
    }
  }
  for (const target of targets) {
    const values = host?.plugins?.[target.pluginId]?.[target.settingsId];
    if (values === undefined) continue;
    const plugin = target.plugin;
    if (plugin) {
      tasks.push({
        section: `${target.label} settings`,
        work: () => writePluginValues(plugin, target.settingsId, values),
      });
    } else {
      skipped.push(`${target.label} (not installed on this host)`);
    }
  }
  return tasks;
}

export function useBrunoConfigFile(serverId: string | null) {
  const { settings, updateSettings } = useAppSettings();
  const desktop = useDesktopSettings();
  const { config: daemonConfig, patchConfig } = useDaemonConfig(serverId);
  const jevPlugin = useInstalledPlugin(serverId ?? "", JEV_ROUTER_PLUGIN_ID);
  const delegationPlugin = useInstalledPlugin(serverId ?? "", DELEGATION_PLUGIN_ID);
  const [busy, setBusy] = useState(false);

  const targets = useMemo<PluginTarget[]>(
    () => [
      {
        label: "Jev router",
        pluginId: JEV_ROUTER_PLUGIN_ID,
        settingsId: JEV_ROUTER_SETTINGS_ID,
        plugin: jevPlugin,
      },
      {
        label: "Delegation",
        pluginId: DELEGATION_PLUGIN_ID,
        settingsId: DELEGATION_SETTINGS_ID,
        plugin: delegationPlugin,
      },
    ],
    [jevPlugin, delegationPlugin],
  );

  const save = useCallback(async (): Promise<{ skipped: string[] }> => {
    setBusy(true);
    try {
      const skipped: string[] = [];
      const snapshot: BrunoConfigSnapshot = {
        app: Object.fromEntries(APP_KEYS.map((key) => [key, settings[key]])),
      };
      if (getIsElectron()) {
        snapshot.desktop = {
          flexibleTabMovement: desktop.settings.tabs?.flexibleMovement === true,
        };
      }
      if (serverId) {
        const plugins: Record<string, Record<string, JsonValue>> = {};
        for (const target of targets) {
          if (!target.plugin) {
            skipped.push(`${target.label} (not installed on this host)`);
            continue;
          }
          plugins[target.pluginId] = {
            [target.settingsId]: await readPluginValues(target.plugin, target.settingsId),
          };
        }
        snapshot.host = {
          github: { configDir: daemonConfig?.github?.configDir ?? "" },
          ...(daemonConfig?.speech ? { speech: daemonConfig.speech } : {}),
          ...(daemonConfig?.features ? { features: daemonConfig.features } : {}),
          plugins,
        };
      }
      downloadTextFile(BRUNO_CONFIG_FILE_NAME, serializeBrunoConfig(snapshot));
      return { skipped };
    } finally {
      setBusy(false);
    }
  }, [settings, desktop.settings.tabs?.flexibleMovement, serverId, daemonConfig, targets]);

  /** Picks and parses a file. `null` is a cancelled picker. */
  const pick = useCallback(async (): Promise<PreparedLoad | LoadReport | null> => {
    let text: string | null;
    try {
      text = await pickTextFile(".json,application/json");
    } catch {
      return { refused: "Could not read that file.", applied: [], skipped: [], failed: [] };
    }
    if (text === null) return null;
    const parsed = parseBrunoConfig(text);
    if (!parsed.ok) {
      return {
        refused: BRUNO_CONFIG_ERROR_MESSAGES[parsed.reason],
        applied: [],
        skipped: [],
        failed: [],
      };
    }
    const { config } = parsed;
    const sections: string[] = [];
    if (config.app) sections.push("App settings");
    if (config.desktop) sections.push("Desktop settings");
    if (config.host) sections.push("Host settings");
    return { config, sections };
  }, []);

  const apply = useCallback(
    async (config: BrunoConfig): Promise<LoadReport> => {
      setBusy(true);
      const report: LoadReport = { refused: null, applied: [], skipped: [], failed: [] };
      const run = async (section: string, work: () => Promise<void>) => {
        try {
          await work();
          report.applied.push(section);
        } catch (error) {
          report.failed.push({ section, error: toErrorMessage(error) });
        }
      };
      try {
        if (config.app) {
          const updates: Record<string, unknown> = {};
          for (const key of APP_KEYS) {
            if (config.app[key] !== undefined) updates[key] = config.app[key];
          }
          if (Object.keys(updates).length > 0) {
            await run("App settings", () => updateSettings(updates as AppUpdate));
          }
        }
        const flexible = config.desktop?.flexibleTabMovement;
        if (flexible !== undefined) {
          if (getIsElectron()) {
            await run("Flexible tab movement", () =>
              desktop.updateSettings({ tabs: { flexibleMovement: flexible } }),
            );
          } else {
            report.skipped.push("Flexible tab movement (desktop app only)");
          }
        }
        const host = config.host;
        if (host && !serverId) report.skipped.push("Host settings (no active host)");
        const tasks = hostTasks({ host, serverId, targets, patchConfig, skipped: report.skipped });
        for (const task of tasks) await run(task.section, task.work);
      } finally {
        setBusy(false);
      }
      return report;
    },
    [updateSettings, desktop, serverId, patchConfig, targets],
  );

  return { busy, save, pick, apply };
}
