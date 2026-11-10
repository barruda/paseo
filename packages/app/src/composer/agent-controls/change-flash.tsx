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
const JEV_FLASH_OUT_MS = 1100;

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
  jevSignal,
  onJevSignalShown,
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
  /** A new id flashes green, even on mount: Jev moved this chip (jev-router/flash-signal.ts). */
  jevSignal?: number;
  onJevSignalShown?: () => void;
  children: ReactNode;
}) {
  const opacity = useSharedValue(0);
  const jevOpacity = useSharedValue(0);
  const previous = useRef<string | null | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    const flash = mounted.current
      ? shouldFlashChange(previous.current, value)
      : flashOnMount && Boolean(value);
    mounted.current = true;
    previous.current = value;
    // The green flash covers a change Jev made; no grey one on top of it.
    if (!flash || jevSignal) return;
    opacity.value = withSequence(
      withTiming(peakOpacity, { duration: FLASH_IN_MS }),
      withTiming(0, { duration: FLASH_OUT_MS }),
    );
  }, [flashOnMount, jevSignal, opacity, peakOpacity, value]);

  useEffect(() => {
    if (!jevSignal) return;
    jevOpacity.value = withSequence(
      withTiming(1, { duration: FLASH_IN_MS }),
      withTiming(0, { duration: JEV_FLASH_OUT_MS }),
    );
    onJevSignalShown?.();
  }, [jevOpacity, jevSignal, onJevSignalShown]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const jevAnimated = useAnimatedStyle(() => ({ opacity: jevOpacity.value }));
  return (
    <View style={[styles.container, style]}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.overlay, overlayStyle, animated]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.overlay, styles.jevOverlay, jevAnimated]}
      />
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
  // CUSTOM(jev-router): the route chip's green (jev-router/route-chip.tsx).
  jevOverlay: {
    backgroundColor:
      theme.colorScheme === "dark" ? "rgba(120, 220, 160, 0.45)" : "rgba(32, 116, 74, 0.3)",
  },
}));
