import { memo } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import {
  StatusRingFrame,
  type StatusRingProps,
  rotatorStyles,
  styles,
} from "@/components/status-ring/frame";
import { useStatusRingRotation } from "@/components/status-ring/clock";
import {
  getStatusRingRotation,
  STATUS_RING_PERIOD_MS,
  STATUS_RING_WAITING_PERIOD_MS,
} from "@/components/status-ring/geometry";

/**
 * Native running indicator. The rotation is published by one shared UI-thread clock rather than
 * per-instance timing, so a ring that mounts mid-flight is already in phase — see `clock.ts`.
 *
 * The rotated view carries no theme-tracked style; the coloured arc is nested inside it. Putting
 * a Unistyles style on a Reanimated view crashes on theme change (docs/unistyles.md).
 */
export const StatusRing = memo(function StatusRing({
  backdrop,
  variant = "running",
}: StatusRingProps) {
  const nowMs = useStatusRingRotation();
  const periodMs = variant === "waiting" ? STATUS_RING_WAITING_PERIOD_MS : STATUS_RING_PERIOD_MS;
  const rotatorStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${getStatusRingRotation(nowMs.value, periodMs)}deg` }],
  }));

  return (
    <StatusRingFrame backdrop={backdrop} variant={variant}>
      <Animated.View style={[rotatorStyles.rotator, rotatorStyle]}>
        <View style={variant === "waiting" ? styles.arcWaiting : styles.arc} />
      </Animated.View>
    </StatusRingFrame>
  );
});
