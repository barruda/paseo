import { useEffect, useRef } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";

export function useMiddleClick(action: () => void) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!isWeb) return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    const handle = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      action();
    };
    const preventScroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    node.addEventListener("auxclick", handle);
    node.addEventListener("mousedown", preventScroll);
    return () => {
      node.removeEventListener("auxclick", handle);
      node.removeEventListener("mousedown", preventScroll);
    };
  }, [action]);
  return ref;
}
