// CUSTOM(desks): shortcut hints describe the active navigation mode.
import { useTaskNavigationStore } from "@/task-navigation/store";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Shortcut } from "@/components/ui/shortcut";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { getIsElectronRuntime } from "@/constants/layout";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { countFittingShortcuts, estimateShortcutWidth, STRIP_MARGIN_PX } from "./fit";
import { useHeaderWidths } from "./layout";

/**
 * Help ids (Settings → Shortcuts) with a label of two words at most, most useful first: a narrow
 * header drops them from the end.
 */
export const HEADER_SHORTCUTS: readonly { id: string; label: string }[] = [
  { id: "new-workspace", label: "New workspace" },
  { id: "open-model-picker", label: "Model" },
  { id: "cycle-active-workspaces", label: "Next active" },
  { id: "workspace-tab-new", label: "New tab" },
  { id: "toggle-command-center", label: "Search" },
  { id: "toggle-bottom-panel", label: "Bottom panel" },
];

/**
 * The everyday shortcuts, in the workspace header left of the header buttons. Desktop layout only.
 * Each shows its current binding, overrides included; one with no binding is left out.
 */
export function HeaderShortcutsStrip({ layoutKey }: { layoutKey: string | null }) {
  const desks = useTaskNavigationStore((s) => s.enabled);
  const compact = useIsCompactFormFactor();
  const available = useKeyboardShortcutsAvailable();
  const widths = useHeaderWidths(layoutKey);
  const { overrides } = useKeyboardShortcutOverrides();
  if (compact || !available || !widths) return null;

  const platform = { isMac: getShortcutOs() === "mac", isDesktop: getIsElectronRuntime() };
  const entries = HEADER_SHORTCUTS.flatMap((entry) => {
    if (desks && entry.id === "new-workspace") return [];
    const keys = resolveShortcutKeysForAction(
      desks && entry.id === "cycle-active-workspaces" ? "task-next-desk" : entry.id,
      overrides,
      platform,
    );
    return keys
      ? [
          {
            ...entry,
            label: desks && entry.id === "cycle-active-workspaces" ? "Next Desk" : entry.label,
            keys,
          },
        ]
      : [];
  });
  const count = countFittingShortcuts({
    headerWidth: widths.header,
    buttonsWidth: widths.buttons,
    itemWidths: entries.map((entry) => estimateShortcutWidth(keysText(entry.keys), entry.label)),
  });
  if (count === 0) return null;
  return (
    <View style={styles.strip} testID="header-shortcuts">
      {entries.slice(0, count).map((entry) => (
        <View key={entry.id} style={styles.item}>
          <Shortcut chord={entry.keys} />
          <Text style={styles.label} numberOfLines={1}>
            {entry.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function keysText(chord: ShortcutKey[][]): string {
  return chord.map((combo) => formatShortcut(combo, getShortcutOs())).join(" ");
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginRight: STRIP_MARGIN_PX,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
