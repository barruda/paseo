// CUSTOM(chat-esc-focus): Esc after selecting chat text clears the selection and returns to the
// agent's composer. These rules keep Esc's other jobs (menus, modals, inputs) untouched.

export interface EscapeKeyInput {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

export function isPlainEscape(event: EscapeKeyInput): boolean {
  return (
    event.key === "Escape" &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.defaultPrevented
  );
}

/**
 * Where keyboard focus is relative to the chat timeline:
 * - `body`: nothing focused (the usual state after a mouse selection).
 * - `timeline`: a focusable element inside the timeline.
 * - `ancestor`: a focusable container around the timeline, such as its pane.
 * - `editable`: an input, textarea, or contenteditable anywhere.
 * - `other`: anything else (menus, dialogs, other panes); Esc belongs to it.
 */
export type ChatEscapeFocusKind = "body" | "timeline" | "ancestor" | "editable" | "other";

export function shouldReturnToComposer(input: {
  hasTimelineSelection: boolean;
  focus: ChatEscapeFocusKind;
}): boolean {
  if (!input.hasTimelineSelection) return false;
  return input.focus === "body" || input.focus === "timeline" || input.focus === "ancestor";
}

// Enter and scrolling back to the bottom also return to the composer, so a chat that lost focus
// (no caret) takes typing again without a click. Several chats can be on screen at once (Desk
// panes), so with nothing focused only the chat the user last pointed at or scrolled reacts.

export function isPlainEnter(event: EscapeKeyInput & { isComposing: boolean }): boolean {
  return (
    event.key === "Enter" &&
    !event.isComposing &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.defaultPrevented
  );
}

export function shouldEnterFocusComposer(input: {
  focus: ChatEscapeFocusKind;
  isLastInteracted: boolean;
}): boolean {
  if (input.focus === "timeline") return true;
  return (input.focus === "body" || input.focus === "ancestor") && input.isLastInteracted;
}

export function shouldReachBottomFocusComposer(input: {
  wasNearBottom: boolean;
  isNearBottom: boolean;
  hasTimelineSelection: boolean;
  focus: ChatEscapeFocusKind;
  isLastInteracted: boolean;
}): boolean {
  if (input.wasNearBottom || !input.isNearBottom || input.hasTimelineSelection) return false;
  if (!input.isLastInteracted) return false;
  return input.focus === "body" || input.focus === "timeline" || input.focus === "ancestor";
}
