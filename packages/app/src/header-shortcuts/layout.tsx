import { useCallback, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { create } from "zustand";
// CUSTOM(task-navigation): the mode toggle belongs immediately after the shortcut hints.
import { TaskNavigationToggle } from "@/task-navigation/toggle";
import { HeaderShortcutsStrip } from "./strip";

interface HeaderWidths {
  /** The whole header row. Its width comes from the window, so showing shortcuts can't change it. */
  header: number;
  /** The header buttons alone. */
  buttons: number;
}

interface HeaderShortcutsLayoutState {
  /** Keyed by the header's workspace, since retained workspace screens each have a header. */
  widths: Record<string, HeaderWidths>;
  set(key: string, side: keyof HeaderWidths, width: number): void;
}

const useHeaderShortcutsLayoutStore = create<HeaderShortcutsLayoutState>()((set, get) => ({
  widths: {},
  set: (key, side, width) => {
    const current = get().widths[key] ?? { header: 0, buttons: 0 };
    if (current[side] === width) return;
    set((state) => ({ widths: { ...state.widths, [key]: { ...current, [side]: width } } }));
  },
}));

/**
 * The header's full width and its buttons' width, once measured. Measuring the header row rather
 * than summing its children keeps the strip from feeding back on its own width.
 */
export function useHeaderWidths(key: string | null): { header: number; buttons: number } | null {
  const widths = useHeaderShortcutsLayoutStore((state) => (key ? state.widths[key] : undefined));
  if (!widths || widths.header === 0 || widths.buttons === 0) return null;
  return widths;
}

function useReportWidth(key: string | null, side: keyof HeaderWidths) {
  return useCallback(
    (event: LayoutChangeEvent) => {
      if (!key) return;
      useHeaderShortcutsLayoutStore
        .getState()
        .set(key, side, Math.round(event.nativeEvent.layout.width));
    },
    [key, side],
  );
}

/** Passed to the header's row (`ScreenHeader` `onRowLayout`) to measure the header's full width. */
export function useHeaderShortcutsRowLayout(layoutKey: string | null) {
  return useReportWidth(layoutKey, "header");
}

/**
 * The header's right side: the shortcut strip, then the header buttons in a row with the style
 * upstream gives them. The buttons report their width.
 */
export function HeaderShortcutsRightRow({
  layoutKey,
  style,
  children,
}: {
  layoutKey: string | null;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const onButtonsLayout = useReportWidth(layoutKey, "buttons");
  return (
    <View style={styles.right}>
      <HeaderShortcutsStrip layoutKey={layoutKey} />
      <View style={style} onLayout={onButtonsLayout}>
        <TaskNavigationToggle />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: "row", alignItems: "center" },
});
