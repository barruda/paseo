// CUSTOM(voice-hold-to-talk): on web and desktop, holding Enter or Space in voice mode does what
// holding the hand button does: the voice turn stays open and releasing it sends. The composer's
// text field sits hidden under the voice overlay and usually keeps focus, so it counts as part of
// the overlay; any other text field keeps its keys. A focused button doesn't.
import { useEffect } from "react";

import { isWeb } from "@/constants/platform";
import type { VoiceRuntime } from "@/voice/voice-runtime";

export const VOICE_OVERLAY_TEST_ID = "realtime-voice-overlay";

const HOLD_KEYS = new Set(["Enter", " "]);
// Inputs that take Enter or Space as a click, not as text.
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox"]);

let activeRuntime: VoiceRuntime | null = null;

function isUnderVoiceOverlay(target: HTMLElement): boolean {
  const composer = target.closest('[data-testid="message-input-root"]');
  return composer?.querySelector(`[data-testid="${VOICE_OVERLAY_TEST_ID}"]`) != null;
}

function isTextEntry(target: HTMLElement): boolean {
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
    return true;
  }
  if (target.tagName === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  }
  return TEXT_ROLES.has(target.getAttribute("role") ?? "");
}

// A focused button (a sidebar row, say) doesn't keep the keys: in voice mode they hold. Only a
// text field the user can see, such as a terminal or a search box, keeps them.
function belongsToOtherTextField(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return isTextEntry(target) && !isUnderVoiceOverlay(target);
}

function isHoldKey(event: KeyboardEvent): boolean {
  return (
    HOLD_KEYS.has(event.key) &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

/** True when this key press belongs to hold-to-talk, so global shortcuts must leave it alone. */
export function isVoiceHoldKeyEvent(event: KeyboardEvent): boolean {
  return (
    activeRuntime !== null &&
    isHoldKey(event) &&
    activeRuntime.canHold() &&
    !belongsToOtherTextField(event.target)
  );
}

export function useVoiceHoldKey(runtime: VoiceRuntime): void {
  useEffect(() => {
    if (!isWeb || typeof window === "undefined") {
      return;
    }
    activeRuntime = runtime;
    let heldKey: string | null = null;

    const release = () => {
      if (heldKey === null) return;
      heldKey = null;
      runtime.setHold(false);
    };
    // Capture phase: the hidden composer must not see Enter (send) or Space (a typed space).
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isVoiceHoldKeyEvent(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || heldKey !== null) {
        return;
      }
      heldKey = event.key;
      runtime.setHold(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (heldKey === null || event.key !== heldKey) {
        return;
      }
      // A focused button would otherwise click on Space's keyup.
      event.preventDefault();
      event.stopPropagation();
      release();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", release);
      release();
      if (activeRuntime === runtime) activeRuntime = null;
    };
  }, [runtime]);
}
