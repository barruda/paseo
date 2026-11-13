// CUSTOM(jev-router): "Esc 3×". A plain Escape right after a keyboard interrupt (the Esc or Esc Esc
// bound to `agent.interrupt`) does what the Jev route card's button does: turn the router off and
// start the session over on the model the user picked. The composer records the interrupt, the
// global keydown handler (use-keyboard-shortcuts) reports the next Escape, and the agent panel's
// `useJevEscRestart` listens. Until the restart fires nothing here swallows or delays the existing
// Esc behaviors. Once it fires, users keep hammering Escape, so every Escape is swallowed (no
// focus, no interrupt, no chord progress) until ESC_STORM_QUIET_MS pass since the last one.

import { CHORD_TIMEOUT_MS } from "@/keyboard/keyboard-shortcuts";

export interface KeyboardInterrupt {
  serverId: string;
  agentId: string;
  at: number;
}

export interface EscapeKeyEvent {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

export function isPlainEscape(event: EscapeKeyEvent): boolean {
  return (
    event.key === "Escape" &&
    !event.repeat &&
    !event.isComposing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function shouldRestartOnEscape(
  state: KeyboardInterrupt | null,
  now: number,
  event: EscapeKeyEvent,
): boolean {
  return state !== null && isPlainEscape(event) && now - state.at <= CHORD_TIMEOUT_MS;
}

/** Any other real key (not a bare modifier) between the interrupt and the Esc ends the window. */
export function shouldForgetOnKey(state: KeyboardInterrupt | null, event: EscapeKeyEvent): boolean {
  return state !== null && event.key !== "Escape" && !MODIFIER_KEYS.has(event.key);
}

/** Quiet time after the last swallowed Escape before Escape behaves normally again. */
export const ESC_STORM_QUIET_MS = 2000;

/** Returns true when it started a restart (only then do the Escapes that follow get swallowed). */
type Listener = (target: { serverId: string; agentId: string }) => boolean | void;

let lastInterrupt: KeyboardInterrupt | null = null;
/** Time of the last Escape of the current storm, or null when no storm is on. */
let stormLastEscAt: number | null = null;
const listeners = new Set<Listener>();

export function recordKeyboardInterrupt(serverId: string, agentId: string, now = Date.now()) {
  lastInterrupt = { serverId, agentId, at: now };
}

/**
 * Called for every global keydown, ahead of every other Escape handler. Returns true when the
 * event must be swallowed: the Escape that starts a restart, and every Escape of the storm after
 * it. Emits once per interrupt, then forgets it.
 */
export function noteKeydownAfterInterrupt(event: EscapeKeyEvent, now = Date.now()): boolean {
  if (stormLastEscAt !== null) {
    if (event.key !== "Escape") return false;
    if (now - stormLastEscAt <= ESC_STORM_QUIET_MS) {
      stormLastEscAt = now;
      return true;
    }
    stormLastEscAt = null;
  }
  if (shouldForgetOnKey(lastInterrupt, event)) {
    lastInterrupt = null;
    return false;
  }
  if (!shouldRestartOnEscape(lastInterrupt, now, event)) return false;
  const target = lastInterrupt;
  lastInterrupt = null;
  if (!target) return false;
  let restarted = false;
  for (const listener of listeners) {
    if (listener({ serverId: target.serverId, agentId: target.agentId }) === true) restarted = true;
  }
  if (restarted) stormLastEscAt = now;
  return restarted;
}

export function subscribeJevEscRestart(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const swallowListeners = new Set<() => void>();

/** Told whenever an Escape is swallowed, so pending chord state can be dropped. */
export function subscribeEscapeSwallowed(listener: () => void): () => void {
  swallowListeners.add(listener);
  return () => {
    swallowListeners.delete(listener);
  };
}

// The listener sits on window in the capture phase and is added when this module loads, which is
// before any component effect or lazily attached listener. Window capture runs before everything
// else on the path (document, target, bubble), and stopImmediatePropagation also stops the later
// window-capture listeners (the shortcut handler, overlays, browser pane, recent tabs), so a
// swallowed Escape reaches none of them: not the chord engine, not the composer input, not the
// chat's Esc-to-focus-composer listener.
function handleWindowKeyDown(event: KeyboardEvent) {
  if (!noteKeydownAfterInterrupt(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  for (const listener of swallowListeners) listener();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("keydown", handleWindowKeyDown, true);
}

export function resetKeyboardInterruptForTest() {
  lastInterrupt = null;
  stormLastEscAt = null;
  listeners.clear();
  swallowListeners.clear();
}
