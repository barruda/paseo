// CUSTOM(reopen-closed-tab): Ctrl+Z right after closing Desk tabs reopens them, newest first.
// The shortcut is armed by a close and disarmed by the next other key, so Ctrl+Z keeps undoing text
// in the composer once you have typed anything.
import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
import { useDesksStore, type DeskTabInput } from "./desks-store";

const MAX_CLOSED_TABS = 20;

export interface ClosedDeskTab {
  deskId: string;
  input: DeskTabInput;
}

export interface ClosedTabsState {
  stack: ClosedDeskTab[];
  armed: boolean;
}

export function rememberClosed(state: ClosedTabsState, tabs: ClosedDeskTab[]): ClosedTabsState {
  // An empty launcher has nothing to come back to.
  const kept = tabs.filter((tab) => tab.input.target.kind !== "new_tab");
  if (!kept.length) return state;
  return { stack: [...state.stack, ...kept].slice(-MAX_CLOSED_TABS), armed: true };
}

export interface ReopenKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/** What a keydown does: reopen the newest closed tab, leave the state alone, or disarm. */
export function reopenKeyAction(
  state: ClosedTabsState,
  event: ReopenKey,
): "reopen" | "ignore" | "disarm" {
  if (MODIFIER_KEYS.has(event.key)) return "ignore";
  const isUndo =
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "z";
  if (isUndo && state.armed && state.stack.length) return "reopen";
  return state.armed ? "disarm" : "ignore";
}

let closedTabs: ClosedTabsState = { stack: [], armed: false };

export function rememberClosedDeskTabs(deskId: string, tabs: DeskTabInput[]): void {
  closedTabs = rememberClosed(
    closedTabs,
    tabs.map((input) => ({ deskId, input })),
  );
}

function reopenLastClosedDeskTab(): void {
  const entry = closedTabs.stack.at(-1);
  if (!entry) return;
  closedTabs = { ...closedTabs, stack: closedTabs.stack.slice(0, -1) };
  const store = useDesksStore.getState();
  if (store.activeDeskId !== entry.deskId && store.desks.some((desk) => desk.id === entry.deskId))
    store.selectDesk(entry.deskId);
  store.openTab(entry.input, true);
}

export function useReopenClosedTabShortcut(enabled: boolean): void {
  useEffect(() => {
    if (!isWeb || !enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = reopenKeyAction(closedTabs, event);
      if (action === "ignore") return;
      if (action === "disarm") {
        closedTabs = { ...closedTabs, armed: false };
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      reopenLastClosedDeskTab();
    };
    // Capture, so the composer's own undo never sees the Ctrl+Z that reopens a tab.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
