// CUSTOM(jev-router): a discreet flash over a composer chip when its value changes (the model or
// effort switched by ←/→, a chip click, Ctrl+M or Jev), so a change made without looking at the
// chip still registers. The first value a chip shows (mount, a selection loading in) never flashes.

import { useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

const FLASH_IN_MS = 120;
const FLASH_OUT_MS = 700;

/** True when `value` moved from one non-empty value to another. */
export function shouldFlashChange(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return Boolean(previous) && Boolean(next) && previous !== next;
}

export function ChangeFlash({
  value,
  flashOnMount = false,
  peakOpacity = 1,
  style,
  overlayStyle,
  children,
}: {
  /** Flashes when this changes. */
  value: string | null | undefined;
  /** Also flash once when the chip first appears (a chip that only exists to announce a change). */
  flashOnMount?: boolean;
  peakOpacity?: number;
  style?: StyleProp<ViewStyle>;
  /** Overrides the overlay's color or radius. */
  overlayStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const opacity = useSharedValue(0);
  const previous = useRef<string | null | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    const flash = mounted.current
      ? shouldFlashChange(previous.current, value)
      : flashOnMount && Boolean(value);
    mounted.current = true;
    previous.current = value;
    if (!flash) return;
    opacity.value = withSequence(
      withTiming(peakOpacity, { duration: FLASH_IN_MS }),
      withTiming(0, { duration: FLASH_OUT_MS }),
    );
  }, [flashOnMount, opacity, peakOpacity, value]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View style={[styles.container, style]}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.overlay, overlayStyle, animated]} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
    minWidth: 0,
    flexShrink: 1,
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.borderRadius.md,
    backgroundColor:
      theme.colorScheme === "dark" ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)",
  },
}));
