// CUSTOM(model-picker-focus): which composer owns the keyboard. Several composers can be "active"
// at once (the focused pane's chat and the Project Manager tab in the right sidebar both get
// isPaneFocused), so their message-input shortcuts (Ctrl+M, ←/→) all registered and the dispatcher
// picked one by priority and registration order: usually the central tab, wherever the caret was.
// Handlers that act on one composer's agent ask `isComposerKeyboardTarget(composerId)` instead.

import { isWeb } from "@/constants/platform";

/** The attribute each message input root carries (RN `dataSet={{ composerId }}`). */
export const COMPOSER_ID_ATTRIBUTE = "data-composer-id";

let lastFocusedComposerId: string | null = null;

/** A composer's text input took focus: it owns the keyboard until another one does. */
export function markComposerFocused(composerId: string): void {
  lastFocusedComposerId = composerId;
}

/** A composer unmounted: forget it if it was the last one focused. */
export function releaseComposerFocus(composerId: string): void {
  if (lastFocusedComposerId === composerId) lastFocusedComposerId = null;
}

function composerIdOfActiveElement(): string | null {
  if (!isWeb || typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!active || typeof active.closest !== "function") return null;
  return active.closest(`[${COMPOSER_ID_ATTRIBUTE}]`)?.getAttribute(COMPOSER_ID_ATTRIBUTE) ?? null;
}

/**
 * CUSTOM(chat-esc-focus): the composer whose input (or toolbar chip) holds the caret right now. On
 * native there is no active element to read, so the composer focused last stands in.
 */
export function composerIdHoldingCaret(): string | null {
  return isWeb ? composerIdOfActiveElement() : lastFocusedComposerId;
}

/**
 * The composer the keyboard acts on: on web the one holding the focused element (its text input
 * or one of its toolbar chips), otherwise the composer whose text input was focused last.
 */
export function resolveKeyboardTargetComposerId(): string | null {
  return composerIdOfActiveElement() ?? lastFocusedComposerId;
}

/** True when keyboard shortcuts should act on this composer. No known owner keeps old behavior. */
export function isComposerKeyboardTarget(composerId: string): boolean {
  const target = resolveKeyboardTargetComposerId();
  return target === null || target === composerId;
}

/** Test helper. */
export function resetComposerFocusForTests(): void {
  lastFocusedComposerId = null;
}
