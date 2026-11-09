// CUSTOM(mouse-tab-nav): the mouse's back button goes to the last visited tab (like Ctrl+Tab) and
// the forward button revisits the tab we came from. Chromium's default for these buttons is
// `history.back()`, which moves between routes (often landing in Settings) instead of tabs, so a
// press a tab handler takes is kept from reaching it. Presses inside a browser pane's <webview>
// are forwarded by the guest preload.
import { useEffect } from "react";
import type { createKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";

type KeyboardActionDispatcher = ReturnType<typeof createKeyboardActionDispatcher>;

const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;

export function useMouseTabNavigation(input: {
  dispatcher: KeyboardActionDispatcher;
  enabled: boolean;
}): void {
  const { dispatcher, enabled } = input;
  useEffect(() => {
    if (!enabled) return;
    const isNavButton = (event: MouseEvent) =>
      event.button === BACK_BUTTON || event.button === FORWARD_BUTTON;
    const onMouseDown = (event: MouseEvent) => {
      if (isNavButton(event)) event.preventDefault();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!isNavButton(event)) return;
      const handled = dispatcher.dispatch({
        id: "workspace.tab.navigate-recent",
        scope: "workspace",
        delta: event.button === BACK_BUTTON ? 1 : -1,
        immediate: true,
      });
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onGuestButton = (event: Event) => {
      const button = (event as CustomEvent<unknown>).detail;
      if (button !== BACK_BUTTON && button !== FORWARD_BUTTON) return;
      dispatcher.dispatch({
        id: "workspace.tab.navigate-recent",
        scope: "workspace",
        delta: button === BACK_BUTTON ? 1 : -1,
        immediate: true,
      });
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("paseo:mouse-tab-navigation", onGuestButton);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("paseo:mouse-tab-navigation", onGuestButton);
    };
  }, [dispatcher, enabled]);
}
