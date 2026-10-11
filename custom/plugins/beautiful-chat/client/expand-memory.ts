import { useCallback, useState } from "react";

// CUSTOM(beautiful-chat-collapse): upstream picks a card's open state once, from whether the item
// was still running when the card mounted, so every card in a live chat stayed open. Instead each
// kind of card (a tool name, or "thinking") starts the way the user last left a card of that kind,
// and closed until they choose.

const STORAGE_KEY = "paseo/beautiful-chat/expanded/v1";

export type ExpandMemoryState = Record<string, boolean>;

export interface ExpandMemory {
  isExpanded(kind: string): boolean;
  remember(kind: string, expanded: boolean): void;
}

export function createExpandMemory(storage: () => Storage | undefined): ExpandMemory {
  // Kept for when storage is missing or throws, so a choice still lasts the session.
  let fallback: ExpandMemoryState = {};

  function read(): ExpandMemoryState {
    try {
      const stored = storage()?.getItem(STORAGE_KEY);
      if (!stored) return fallback;
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
      const state: ExpandMemoryState = {};
      for (const [kind, value] of Object.entries(parsed)) {
        if (typeof value === "boolean") state[kind] = value;
      }
      return state;
    } catch {
      return fallback;
    }
  }

  return {
    // Read on every mount, so a choice made in another window applies to the next card here.
    isExpanded(kind) {
      return read()[kind] ?? false;
    },
    remember(kind, expanded) {
      fallback = { ...read(), [kind]: expanded };
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(fallback));
      } catch {
        // Browser storage can be disabled. The fallback keeps the choice for this session.
      }
    },
  };
}

const memory = createExpandMemory(() => {
  const candidate = globalThis as typeof globalThis & { localStorage?: Storage };
  return candidate.localStorage;
});

/** Open state for one card, starting from and saving to the remembered state of its kind. */
export function useRememberedExpanded(kind: string): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => memory.isExpanded(kind));
  const toggle = useCallback(() => {
    const next = !expanded;
    memory.remember(kind, next);
    setExpanded(next);
  }, [expanded, kind]);
  return [expanded, toggle];
}
