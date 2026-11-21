// CUSTOM(chat-esc-focus): where Focus message input (Esc) and Interrupt agent (Esc Esc) land when
// several composers are active at once. The Explorer sidebar (the Project Manager tab, an agent
// dragged into Explorer) is always "pane focused", so its composer competed with the central
// tab's: with the caret in it, its focus handler had the higher priority and Esc kept the caret
// there; with nothing focused, the newest registration won. A composer under
// `SecondaryComposerProvider` never takes the focus action while a primary composer (the focused
// pane's chat, a Desk pane, an embedded agent screen) is active, and only interrupts its own agent
// when the Esc sequence started in it. Primary composers keep their old priorities, so embedded
// composers outside the sidebar behave as before.

import { createContext, useContext, type ReactNode } from "react";
import { composerIdHoldingCaret } from "@/composer/focused-composer";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { CHORD_TIMEOUT_MS } from "@/keyboard/keyboard-shortcuts";

const SecondaryComposerContext = createContext(false);

/** Marks every composer and chat below it as a side panel's (see the file comment). */
export function SecondaryComposerProvider({ children }: { children: ReactNode }) {
  return (
    <SecondaryComposerContext.Provider value={true}>{children}</SecondaryComposerContext.Provider>
  );
}

export function useIsSecondaryComposer(): boolean {
  return useContext(SecondaryComposerContext);
}

/** The composer handlers' usual priority: the one whose input has the caret goes first. */
export function resolveComposerKeyboardPriority(isMessageInputFocused: boolean): number {
  return isMessageInputFocused ? 200 : 100;
}

/** Below every primary composer, so a secondary one only gets the focus action when alone. */
const SECONDARY_FOCUS_PRIORITY = 50;
/** Above the primary composer that just took the caret, for the Esc Esc that started here. */
const SECONDARY_INTERRUPT_PRIORITY = 300;

export function resolveFocusActionPriority(input: {
  secondary: boolean;
  isMessageInputFocused: boolean;
}): number {
  if (input.secondary) return SECONDARY_FOCUS_PRIORITY;
  return resolveComposerKeyboardPriority(input.isMessageInputFocused);
}

export function resolveInterruptActionPriority(input: {
  secondary: boolean;
  isMessageInputFocused: boolean;
}): number {
  if (input.secondary) return SECONDARY_INTERRUPT_PRIORITY;
  return resolveComposerKeyboardPriority(input.isMessageInputFocused);
}

// The composer that held the caret when Focus message input moved it elsewhere. Esc Esc fires the
// focus action on the first press and the interrupt on the second, so by the interrupt the caret
// already sits in the central composer; this keeps the interrupt on the agent the user was in.
let escapeOrigin: { composerId: string; at: number } | null = null;

export function noteEscapeOrigin(input: {
  fromComposerId: string | null;
  toComposerId: string;
  now: number;
}): void {
  escapeOrigin =
    input.fromComposerId && input.fromComposerId !== input.toComposerId
      ? { composerId: input.fromComposerId, at: input.now }
      : null;
}

export function isEscapeOrigin(composerId: string, now: number): boolean {
  return (
    escapeOrigin !== null &&
    escapeOrigin.composerId === composerId &&
    now - escapeOrigin.at <= CHORD_TIMEOUT_MS
  );
}

function clearEscapeOrigin(): void {
  escapeOrigin = null;
}

/** A secondary composer interrupts only from its own caret or the Esc Esc that started in it. */
export function shouldSecondaryInterrupt(composerId: string, now: number): boolean {
  return composerIdHoldingCaret() === composerId || isEscapeOrigin(composerId, now);
}

/** Test helper. */
export function resetEscapeOriginForTests(): void {
  clearEscapeOrigin();
}

/**
 * Registers a composer's `message-input.focus` and `agent.interrupt` handlers. `handle` runs the
 * action on this composer (focus its input, interrupt its agent) and returns whether it did.
 */
export function useComposerEscRouting(input: {
  handlerId: string;
  composerId: string;
  enabled: boolean;
  isMessageInputFocused: boolean;
  handle: (action: KeyboardActionDefinition) => boolean;
}): void {
  const secondary = useIsSecondaryComposer();
  const { handlerId, composerId, enabled, isMessageInputFocused, handle } = input;

  useKeyboardActionHandler({
    handlerId: `${handlerId}:focus`,
    actions: ["message-input.focus"],
    enabled,
    priority: resolveFocusActionPriority({ secondary, isMessageInputFocused }),
    handle: (action) => {
      noteEscapeOrigin({
        fromComposerId: composerIdHoldingCaret(),
        toComposerId: composerId,
        now: Date.now(),
      });
      return handle(action);
    },
  });

  useKeyboardActionHandler({
    handlerId: `${handlerId}:interrupt`,
    actions: ["agent.interrupt"],
    enabled,
    priority: resolveInterruptActionPriority({ secondary, isMessageInputFocused }),
    isActive: secondary ? () => shouldSecondaryInterrupt(composerId, Date.now()) : undefined,
    handle: (action) => {
      if (secondary) clearEscapeOrigin();
      return handle(action);
    },
  });
}
