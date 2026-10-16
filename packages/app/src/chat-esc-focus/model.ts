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
