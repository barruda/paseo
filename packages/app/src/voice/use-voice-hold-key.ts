// CUSTOM(voice-hold-to-talk): on web and desktop, holding Enter keeps the voice turn open and
// releasing it sends. Ignored while a text field has focus, so typing is untouched.
import { useEffect } from "react";

import { isWeb } from "@/constants/platform";
import type { VoiceRuntime } from "@/voice/voice-runtime";

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useVoiceHoldKey(runtime: VoiceRuntime): void {
  useEffect(() => {
    if (!isWeb || typeof window === "undefined") {
      return;
    }
    let keyHeld = false;

    const release = () => {
      if (!keyHeld) return;
      keyHeld = false;
      runtime.setHold(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (!runtime.getSnapshot().isVoiceMode || isTextEntryTarget(event.target)) {
        return;
      }
      event.preventDefault();
      keyHeld = true;
      runtime.setHold(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        release();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, [runtime]);
}
