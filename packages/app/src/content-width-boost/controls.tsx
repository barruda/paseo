// CUSTOM(content-width-boost): -, + and maximize buttons at the top left of the agent panel.
import { Maximize, Minimize, Minus, Plus } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { useCustomDesktopWindowControls } from "@/utils/desktop-window";
import { CONTENT_WIDTH_BOOST_STEPS, useContentWidthBoostStore } from "./store";

const ThemedMinus = withUnistyles(Minus);
const ThemedPlus = withUnistyles(Plus);
const ThemedMaximize = withUnistyles(Maximize);
const ThemedMinimize = withUnistyles(Minimize);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

export function ContentWidthBoostControls() {
  const { isMaximized } = useCustomDesktopWindowControls();
  const stepIndex = useContentWidthBoostStore((s) => s.stepIndex);
  const grow = useContentWidthBoostStore((s) => s.grow);
  const shrink = useContentWidthBoostStore((s) => s.shrink);
  const toggleFull = useContentWidthBoostStore((s) => s.toggleFull);
  const setWindowMaximized = useContentWidthBoostStore((s) => s.setWindowMaximized);

  useEffect(() => {
    setWindowMaximized(isMaximized);
  }, [isMaximized, setWindowMaximized]);

  if (!isWeb || !isMaximized) return null;
  const isFull = stepIndex === CONTENT_WIDTH_BOOST_STEPS.length - 1;

  return (
    <View style={styles.row} testID="content-width-boost">
      <Pressable
        accessibilityLabel="Narrower content"
        disabled={stepIndex === 0}
        onPress={shrink}
        style={styles.button}
      >
        <ThemedMinus size={14} uniProps={iconColor} />
      </Pressable>
      <Pressable
        accessibilityLabel="Wider content"
        disabled={isFull}
        onPress={grow}
        style={styles.button}
      >
        <ThemedPlus size={14} uniProps={iconColor} />
      </Pressable>
      <Pressable
        accessibilityLabel={isFull ? "Restore content width" : "Full width content"}
        onPress={toggleFull}
        style={styles.button}
      >
        {isFull ? (
          <ThemedMinimize size={14} uniProps={iconColor} />
        ) : (
          <ThemedMaximize size={14} uniProps={iconColor} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    position: "absolute",
    top: theme.spacing[1],
    left: theme.spacing[2],
    zIndex: 10,
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  button: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
}));
