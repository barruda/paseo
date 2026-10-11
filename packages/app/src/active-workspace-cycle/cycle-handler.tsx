import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/contexts/toast-api-context";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  collectRecentlyActiveWorkspaces,
  nextRecentlyActiveWorkspace,
  type CycleWorkspaceTarget,
} from "./model";
import { useSidebarWorkspaceOrder } from "./use-recently-active-workspaces";

const ACTIONS = ["message-input.active-workspace-cycle"] as const;
// The next workspace's composer mounts or becomes active over a few frames; ask twice.
const REFOCUS_DELAYS_MS = [60, 250];

/**
 * Handles Shift+Tab in a message input: go to the next workspace, in sidebar order, that had
 * activity in the last 45 minutes. Mounted once, inside the sidebar model.
 */
export function ActiveWorkspaceCycleHandler({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const dispatcher = useKeyboardActionDispatcher();
  const order = useSidebarWorkspaceOrder();
  const active = useActiveWorkspaceSelection();
  // The route catches up a render after navigating; quick repeated presses use the last target.
  const pendingRef = useRef<CycleWorkspaceTarget | null>(null);
  useEffect(() => {
    pendingRef.current = null;
  }, [active?.serverId, active?.workspaceId]);

  const handle = useCallback(
    (action: KeyboardActionDefinition) => {
      if (action.id !== "message-input.active-workspace-cycle") return false;
      const state = useSessionStore.getState();
      const targets = collectRecentlyActiveWorkspaces({
        order,
        sessions: state.sessions,
        agentLastActivity: state.agentLastActivity,
        now: Date.now(),
      });
      const current = pendingRef.current ?? active;
      const next = nextRecentlyActiveWorkspace(targets, current);
      if (!next) {
        toast.show("No other workspace had activity in the last 45 minutes");
        return true;
      }
      pendingRef.current = next;
      navigateToWorkspace({ serverId: next.serverId, workspaceId: next.workspaceId });
      // Keep focus in a message input so the next Shift+Tab keeps cycling.
      for (const delay of REFOCUS_DELAYS_MS) {
        setTimeout(() => {
          dispatcher.dispatch({ id: "message-input.focus", scope: "message-input" });
        }, delay);
      }
      return true;
    },
    [active, dispatcher, order, toast],
  );

  useKeyboardActionHandler({
    handlerId: "active-workspace-cycle",
    actions: ACTIONS,
    enabled,
    priority: 0,
    handle,
  });
  return null;
}
