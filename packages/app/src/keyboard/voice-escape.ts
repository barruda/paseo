import type { KeyboardShortcutInput } from "./keyboard-shortcuts";
import type { KeyboardActionDefinition } from "./keyboard-action-dispatcher";

// CUSTOM(voice-exit): exit on the first Esc even when interrupt is bound to Esc Esc.
// The caller still advances the chord, but must not interrupt on this same keypress.
export function dispatchVoiceEscape(
  event: KeyboardShortcutInput,
  dispatch: (action: KeyboardActionDefinition) => boolean,
): boolean {
  if (
    event.key !== "Escape" ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return false;
  return dispatch({ id: "message-input.voice-exit", scope: "message-input" });
}
