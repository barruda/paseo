// CUSTOM(reading-modes): the Columns and Compact toggles, together in one pill at the right end of
// the row of pills above the composer. Pressing the lit one returns to the normal chat.
import { Columns3, ListCollapse } from "lucide-react-native";
import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { composerPillStyles } from "@/composer/pill-styles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-color";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { ReadingMode } from "./model";
import { useReadingMode, useReadingModeStore } from "./store";

const ThemedColumns3 = withUnistyles(Columns3);
const ThemedListCollapse = withUnistyles(ListCollapse);
const selectedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const BUTTONS: {
  mode: Exclude<ReadingMode, "chat">;
  label: string;
  Icon: typeof ThemedColumns3;
}[] = [
  { mode: "columns", label: "Columns: the whole chat as pages", Icon: ThemedColumns3 },
  {
    mode: "compact",
    label: "Compact: prompts and final answers as pages",
    Icon: ThemedListCollapse,
  },
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
      tooltipSide="top"
      testID={`reading-mode-${mode}`}
      onPress={handlePress}
    >
      <Icon size={14} uniProps={selected ? selectedIconColorMapping : extraMutedIconColorMapping} />
    </ToolbarButton>
  );
}

/** The modes are a wide-screen layout drawn on web only, so phones and native get no pill. */
export function ReadingModePill({ agentId }: { agentId: string }) {
  const current = useReadingMode(agentId);
  const isCompact = useIsCompactFormFactor();
  if (isNative || isCompact) return null;
  return (
    <View style={[composerPillStyles.body, styles.pill]} testID="reading-mode-pill">
      {BUTTONS.map((button) => (
        <ReadingModeButton
          key={button.mode}
          {...button}
          agentId={agentId}
          selected={current === button.mode}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    // Right-aligned, apart from the pills on the left.
    marginLeft: "auto",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
}));
