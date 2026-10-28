import { useEffect, useRef } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";

export function useMiddleClick(action: () => void, onDoubleClick?: () => void) {
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
    // CUSTOM(task-double-click): a task row opens in a new tab on double click.
    const handleDouble = (event: MouseEvent) => {
      if (event.button !== 0) return;
      onDoubleClick?.();
    };
    node.addEventListener("auxclick", handle);
    node.addEventListener("mousedown", preventScroll);
    node.addEventListener("dblclick", handleDouble);
    return () => {
      node.removeEventListener("auxclick", handle);
      node.removeEventListener("mousedown", preventScroll);
      node.removeEventListener("dblclick", handleDouble);
    };
  }, [action, onDoubleClick]);
  return ref;
}
