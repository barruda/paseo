// CUSTOM(header-cycle): whether the keyboard focus is in the Project Manager tab, so Shift+Tab in
// Tasks mode knows the cycle stands on it. Web only: native has no DOM focus to read.
import { isWeb } from "@/constants/platform";

/** The testID of every root the Project Manager tab renders (`data-testid` on web). */
export const ASSISTANT_PANEL_TEST_ID = "projects-assistant-panel";
const SELECTOR = `[data-testid='${ASSISTANT_PANEL_TEST_ID}']`;

function focusedAssistantElement(): HTMLElement | null {
  if (!isWeb || typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest(SELECTOR)) return null;
  return active;
}

export function isAssistantPanelFocused(): boolean {
  return focusedAssistantElement() !== null;
}

/** Takes the focus out of the Project Manager tab, so the cycle no longer stands on it. */
export function blurAssistantPanel(): void {
  focusedAssistantElement()?.blur();
}
