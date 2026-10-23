// CUSTOM(reading-modes): Compact, Columns, Newspaper and Cards toggles, after the tab row's "+" while an
// agent tab is active. Pressing the lit one returns to the normal chat.
import { Columns3, LayoutGrid, ListCollapse, Newspaper } from "lucide-react-native";
import { useCallback } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { smallIconButtonChromeFrameSize } from "@/components/ui/icon-button-chrome";
import { extraMutedIconColorMapping } from "@/components/ui/icon-color";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { Theme } from "@/styles/theme";
import type { ReadingMode } from "./model";
import { useReadingMode, useReadingModeStore } from "./store";

const ThemedListCollapse = withUnistyles(ListCollapse);
const ThemedNewspaper = withUnistyles(Newspaper);
const ThemedLayoutGrid = withUnistyles(LayoutGrid);
const ThemedColumns3 = withUnistyles(Columns3);
const selectedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const BUTTON_COUNT = 4;
export const READING_MODE_BUTTONS_RESERVED_WIDTH =
  smallIconButtonChromeFrameSize(false) * BUTTON_COUNT + 4;

const BUTTONS: {
  mode: Exclude<ReadingMode, "chat">;
  label: string;
  Icon: typeof ThemedNewspaper;
}[] = [
  { mode: "compact", label: "Compact: prompts and final answers", Icon: ThemedListCollapse },
  {
    mode: "columns",
    label: "Columns: the whole chat in up to three columns",
    Icon: ThemedColumns3,
  },
  {
    mode: "newspaper",
    label: "Newspaper: prompts and final answers in columns",
    Icon: ThemedNewspaper,
  },
  { mode: "cards", label: "Cards: one card per turn", Icon: ThemedLayoutGrid },
];

function ReadingModeButton({
  agentId,
  mode,
  label,
  Icon,
  selected,
}: (typeof BUTTONS)[number] & { agentId: string; selected: boolean }) {
  const toggle = useReadingModeStore((state) => state.toggle);
  const handlePress = useCallback(() => toggle(agentId, mode), [agentId, mode, toggle]);
  return (
    <ToolbarButton
      label={label}
      selected={selected}
      testID={`reading-mode-${mode}`}
      onPress={handlePress}
    >
      <Icon size={14} uniProps={selected ? selectedIconColorMapping : extraMutedIconColorMapping} />
    </ToolbarButton>
  );
}

/** Renders nothing unless the pane's active tab is an agent. */
export function ReadingModeButtons({
  agentTab,
  wrapperStyle,
}: {
  agentTab: { agentId: string } | null;
  wrapperStyle?: StyleProp<ViewStyle>;
}) {
  const current = useReadingMode(agentTab?.agentId ?? "");
  if (!agentTab) return null;
  return (
    <View style={wrapperStyle}>
      {BUTTONS.map((button) => (
        <ReadingModeButton
          key={button.mode}
          {...button}
          agentId={agentTab.agentId}
          selected={current === button.mode}
        />
      ))}
    </View>
  );
}
