import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";
import type { View as NativeView } from "react-native";
import type { StatusRingVariant } from "@/components/status-ring/frame";
import {
  STATUS_RING_PERIOD_MS,
  STATUS_RING_WAITING_PERIOD_MS,
} from "@/components/status-ring/geometry";

const STATUS_RING_KEYFRAMES: PropertyIndexedKeyframes = {
  transform: ["rotate(0deg)", "rotate(360deg)"],
};
function statusRingTiming(variant: StatusRingVariant): KeyframeAnimationOptions {
  return {
    duration: variant === "waiting" ? STATUS_RING_WAITING_PERIOD_MS : STATUS_RING_PERIOD_MS,
    easing: "linear",
    iterations: Number.POSITIVE_INFINITY,
  };
}
const STATUS_RING_TIMELINE_START_MS = 0;

export function useStatusRingAnimationRef(
  variant: StatusRingVariant = "running",
): RefCallback<NativeView> {
  const arcElement = useRef<HTMLElement | null>(null);
  const setArcElement = useCallback((instance: NativeView | null) => {
    arcElement.current = instance instanceof HTMLElement ? instance : null;
  }, []);

  useLayoutEffect(() => {
    const element = arcElement.current;
    if (!element) {
      return;
    }

    const animation = element.animate(STATUS_RING_KEYFRAMES, statusRingTiming(variant));
    animation.startTime = STATUS_RING_TIMELINE_START_MS;
    return () => {
      animation.cancel();
    };
  }, [variant]);

  return setArcElement;
}
