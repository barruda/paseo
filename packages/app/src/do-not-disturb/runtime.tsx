// CUSTOM(do-not-disturb): keeps the store in sync with the Electron main process, expires timed
// states by itself, and registers the Command Center entries.
import { useEffect, useMemo } from "react";
import { Bell, BellOff } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  DO_NOT_DISTURB_CHANGED_EVENT,
  effectiveDoNotDisturbState,
  isDoNotDisturbActive,
  type DoNotDisturbState,
} from "@getpaseo/protocol/do-not-disturb";
import type {
  CommandCenterContribution,
  CommandCenterIconProps,
} from "@/command-center/contributions";
import { useCommandCenterActions } from "@/command-center/provider";
import { getIsElectron } from "@/constants/platform";
import { getIsElectronRuntime } from "@/constants/layout";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { setDoNotDisturb, useDoNotDisturbStore } from "./store";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const ThemedBell = withUnistyles(Bell, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedBellOff = withUnistyles(BellOff, (theme) => ({ color: theme.colors.foregroundMuted }));

function BellIcon({ size }: CommandCenterIconProps) {
  return <ThemedBell size={size} strokeWidth={2.2} />;
}

function BellOffIcon({ size }: CommandCenterIconProps) {
  return <ThemedBellOff size={size} strokeWidth={2.2} />;
}

const KEYWORDS = [
  "dnd",
  "do not disturb",
  "notifications",
  "silence",
  "mute",
  "quiet",
  "presentation",
  "não perturbe",
  "nao perturbe",
  "silenciar",
  "notificações",
  "apresentação",
];

export function useDoNotDisturb(): { active: boolean; state: DoNotDisturbState } {
  const state = useDoNotDisturbStore((s) => s.state);
  return { active: isDoNotDisturbActive(state, Date.now()), state };
}

export function DoNotDisturbRuntime() {
  const electron = getIsElectron();
  const state = useDoNotDisturbStore((s) => s.state);
  const setState = useDoNotDisturbStore((s) => s.setState);
  const { t } = useTranslation();
  const { overrides } = useKeyboardShortcutOverrides();
  const shortcutPlatform = useMemo(
    () => ({ isMac: getShortcutOs() === "mac", isDesktop: getIsElectronRuntime() }),
    [],
  );

  useEffect(() => {
    if (!electron) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    invokeDesktopCommand<DoNotDisturbState>("get_do_not_disturb")
      .then((initial) => {
        if (!disposed) setState(effectiveDoNotDisturbState(initial, Date.now()));
        return undefined;
      })
      .catch((error) => console.warn("[DoNotDisturb] Failed to load state", error));
    listenToDesktopEvent<DoNotDisturbState>(DO_NOT_DISTURB_CHANGED_EVENT, (next) => {
      if (!disposed) setState(effectiveDoNotDisturbState(next, Date.now()));
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
        return undefined;
      })
      .catch((error) => console.warn("[DoNotDisturb] Failed to subscribe", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [electron, setState]);

  useEffect(() => {
    if (!electron || !state.enabled || state.until === null) return;
    const delay = Math.min(Math.max(Date.parse(state.until) - Date.now(), 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      setState(effectiveDoNotDisturbState(state, Date.now()));
    }, delay);
    return () => clearTimeout(timer);
  }, [electron, state, setState]);

  const active = isDoNotDisturbActive(state, Date.now());
  const actions = useMemo<CommandCenterContribution[]>(() => {
    const sectionTitle = t("shell.commandCenter.actions");
    if (active) {
      return [
        {
          id: "do-not-disturb-off",
          group: "actions",
          groupRank: 0,
          rank: 20,
          keywords: KEYWORDS,
          visibility: "always",
          run: () => void setDoNotDisturb({ action: "off" }),
          presentation: {
            kind: "action",
            title: "Turn off Do Not Disturb",
            sectionTitle,
            icon: BellIcon,
            shortcutKeys:
              resolveShortcutKeysForAction("toggle-do-not-disturb", overrides, shortcutPlatform) ??
              undefined,
          },
        },
      ];
    }
    return [
      {
        id: "do-not-disturb-on",
        group: "actions",
        groupRank: 0,
        rank: 20,
        keywords: KEYWORDS,
        visibility: "always",
        run: () => void setDoNotDisturb({ action: "on" }),
        presentation: {
          kind: "action",
          title: "Turn on Do Not Disturb",
          sectionTitle,
          icon: BellOffIcon,
          shortcutKeys:
            resolveShortcutKeysForAction("toggle-do-not-disturb", overrides, shortcutPlatform) ??
            undefined,
        },
      },
      {
        id: "do-not-disturb-on-1h",
        group: "actions",
        groupRank: 0,
        rank: 21,
        keywords: KEYWORDS,
        visibility: "query",
        run: () => void setDoNotDisturb({ action: "on", duration: "1h" }),
        presentation: {
          kind: "action",
          title: "Turn on Do Not Disturb for 1 hour",
          sectionTitle,
          icon: BellOffIcon,
        },
      },
      {
        id: "do-not-disturb-on-tomorrow",
        group: "actions",
        groupRank: 0,
        rank: 22,
        keywords: KEYWORDS,
        visibility: "query",
        run: () => void setDoNotDisturb({ action: "on", duration: "tomorrow" }),
        presentation: {
          kind: "action",
          title: "Turn on Do Not Disturb until tomorrow (8:00)",
          sectionTitle,
          icon: BellOffIcon,
        },
      },
    ];
  }, [active, overrides, shortcutPlatform, t]);

  useCommandCenterActions({ sourceId: "do-not-disturb", enabled: electron, actions });
  return null;
}
