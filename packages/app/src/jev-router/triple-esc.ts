// CUSTOM(jev-router): "Esc 3×". A plain Escape right after a keyboard interrupt (the Esc or Esc Esc
// bound to `agent.interrupt`) does what the Jev route card's button does: turn the router off and
// start the session over on the model the user picked. The composer records the interrupt, the
// global keydown handler (use-keyboard-shortcuts) reports the next Escape, and the agent panel's
// `useJevEscRestart` listens. Nothing here swallows or delays the existing Esc behaviors.

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

type Listener = (target: { serverId: string; agentId: string }) => void;

let lastInterrupt: KeyboardInterrupt | null = null;
const listeners = new Set<Listener>();

export function recordKeyboardInterrupt(serverId: string, agentId: string, now = Date.now()) {
  lastInterrupt = { serverId, agentId, at: now };
}

/** Called for every global keydown. Emits once per interrupt, then forgets it. */
export function noteKeydownAfterInterrupt(event: EscapeKeyEvent, now = Date.now()) {
  if (shouldForgetOnKey(lastInterrupt, event)) {
    lastInterrupt = null;
    return;
  }
  if (!shouldRestartOnEscape(lastInterrupt, now, event)) return;
  const target = lastInterrupt;
  lastInterrupt = null;
  if (!target) return;
  for (const listener of listeners)
    listener({ serverId: target.serverId, agentId: target.agentId });
}

export function subscribeJevEscRestart(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetKeyboardInterruptForTest() {
  lastInterrupt = null;
  listeners.clear();
}
