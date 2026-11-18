// CUSTOM(dictation-hold-enter-sends): while dictation records, a short Enter puts the transcript in
// the composer to review (dictation-enter-inserts) and holding Enter sends it as soon as it
// arrives. The Enter shortcut only sees keydowns, so the composer feeds this controller the
// window's Enter keydown/keyup and blur too.
import { useEffect, useRef } from "react";

import { isWeb } from "@/constants/platform";

/** How long Enter must stay down for the dictation to be sent instead of inserted. */
export const DICTATION_HOLD_ENTER_SEND_MS = 500;

type HoldPhase = "idle" | "pressed" | "sent";

interface TimerApi {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface DictationEnterHoldOptions {
  isRecording: () => boolean;
  /** Short press: stop recording and put the transcript in the composer. */
  confirm: () => void;
  /** Hold reached: stop recording and send the transcript once it arrives. */
  confirmAndSend: () => void;
  timer?: TimerApi;
}

const defaultTimer: TimerApi = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface DictationEnterHold {
  /**
   * The Enter shortcut fired, first press or auto-repeat. True when the hold owns it, so no
   * other Enter handling (send, newline) runs until the key is released.
   */
  press: () => boolean;
  /** A DOM Enter keydown on the window; `repeat` is the keyboard's auto-repeat. */
  keyDown: (repeat: boolean) => void;
  /** A DOM Enter keyup on the window. */
  keyUp: () => void;
  /** The window lost focus; its keyup may never come. */
  blur: () => void;
  dispose: () => void;
}

export function createDictationEnterHold(options: DictationEnterHoldOptions): DictationEnterHold {
  const timer = options.timer ?? defaultTimer;
  let phase: HoldPhase = "idle";
  // Whether the window saw Enter go down and not come up. An Enter typed inside an embedded
  // browser reaches the shortcut but never this window, and must not count as a hold.
  let enterDown = false;
  let handle: unknown = null;

  const clearTimer = () => {
    if (handle === null) return;
    timer.clear(handle);
    handle = null;
  };

  const release = () => {
    clearTimer();
    const previous = phase;
    phase = "idle";
    if (previous === "pressed" && options.isRecording()) {
      options.confirm();
    }
  };

  const reachThreshold = () => {
    handle = null;
    if (phase !== "pressed") return;
    if (!enterDown) {
      release();
      return;
    }
    phase = "sent";
    if (options.isRecording()) {
      options.confirmAndSend();
    }
  };

  return {
    press: () => {
      if (phase !== "idle") return true;
      if (!options.isRecording()) return false;
      phase = "pressed";
      handle = timer.set(reachThreshold, DICTATION_HOLD_ENTER_SEND_MS);
      return true;
    },
    keyDown: (repeat) => {
      enterDown = true;
      // A fresh press after a hold whose keyup never came (released in another app, say).
      if (!repeat && phase === "sent") phase = "idle";
    },
    keyUp: () => {
      enterDown = false;
      release();
    },
    blur: () => {
      enterDown = false;
      release();
    },
    dispose: () => {
      clearTimer();
      phase = "idle";
      enterDown = false;
    },
  };
}

function isPlainEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

/** Web and desktop only: native has no keyboard shortcuts, so Enter never reaches `press`. */
export function useDictationEnterHold(options: DictationEnterHoldOptions): DictationEnterHold {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const holdRef = useRef<DictationEnterHold | null>(null);
  if (holdRef.current === null) {
    holdRef.current = createDictationEnterHold({
      isRecording: () => optionsRef.current.isRecording(),
      confirm: () => optionsRef.current.confirm(),
      confirmAndSend: () => optionsRef.current.confirmAndSend(),
      timer: options.timer,
    });
  }
  const hold = holdRef.current;

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPlainEnter(event)) hold.keyDown(event.repeat);
    };
    // Any Enter release ends the hold, modifiers or not.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Enter") hold.keyUp();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", hold.blur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", hold.blur);
      hold.dispose();
    };
  }, [hold]);

  return hold;
}
