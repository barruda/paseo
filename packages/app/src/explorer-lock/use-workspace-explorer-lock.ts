// CUSTOM(explorer-lock): in the workspace view the Explorer's open/closed state is saved per
// workspace layout. With the lock on, the focused workspace screen shows or hides its Explorer to
// match the locked state when it comes into view, and every open or close made there (button,
// Ctrl+E, Changes, plugins) becomes the locked state.
import { useEffect, useRef } from "react";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { planWorkspaceExplorerLock, type WorkspaceExplorerLockView } from "./model";
import { useExplorerLockSetting } from "./settings";
import { useExplorerLockHydrated, useExplorerLockStore } from "./store";

export function useWorkspaceExplorerLock(input: {
  workspaceKey: string | null;
  routeFocused: boolean;
  /** Compact overlays keep their own state. */
  compact: boolean;
  visible: boolean;
}): void {
  const { lockOn, settingsLoaded } = useExplorerLockSetting("workspaces");
  const hydrated = useExplorerLockHydrated();
  const lockedOpen = useExplorerLockStore((state) => state.open);
  const previous = useRef<WorkspaceExplorerLockView | null>(null);
  const { workspaceKey, visible } = input;
  const active = input.routeFocused && !input.compact;
  useEffect(() => {
    if (!hydrated || !workspaceKey) return;
    const current = { workspaceKey, active, visible, lockOn, settingsLoaded };
    const action = planWorkspaceExplorerLock({
      previous: previous.current,
      current,
      lockedOpen,
    });
    previous.current = current;
    if (!action) return;
    if (action.kind === "record") {
      useExplorerLockStore.getState().setOpen(action.open);
      return;
    }
    const store = useWorkspaceLayoutStore.getState();
    if (action.open) store.showExplorerSidebar(workspaceKey);
    else store.hideExplorerSidebar(workspaceKey);
  }, [active, hydrated, lockOn, lockedOpen, settingsLoaded, visible, workspaceKey]);
}
