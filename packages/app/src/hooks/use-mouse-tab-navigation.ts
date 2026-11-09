// CUSTOM(mouse-tab-nav): the mouse's back/forward buttons only do something on web.
import type { createKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";

type KeyboardActionDispatcher = ReturnType<typeof createKeyboardActionDispatcher>;

export function useMouseTabNavigation(_input: {
  dispatcher: KeyboardActionDispatcher;
  enabled: boolean;
}): void {}
