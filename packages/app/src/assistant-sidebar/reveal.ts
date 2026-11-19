// CUSTOM(assistant-sidebar): the focused Desk or workspace screen reveals the Projects Assistant
// tab in its Explorer sidebar when openAssistantSidebar asks for it.
import { useEffect, useRef } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { focusChatComposer } from "@/chat-esc-focus/registry";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { showExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";
import { currentAssistantChat } from "./open";
import { useAssistantSidebarStore } from "./store";

const FOCUS_RETRY_MS = 100;
const FOCUS_GIVE_UP_MS = 3000;

/** Opens the workspace's Explorer and selects (or adds) its Projects Assistant tab. */
export function revealAssistantTab(input: { workspaceKey: string; isCompact: boolean }): void {
  const paneId = showExplorerSidebar(input);
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: input.workspaceKey,
    target: { kind: "projects_assistant" },
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
  });
}

/** Focuses the chat's composer once the tab has mounted it. */
function focusComposerSoon(preferredServerId: string | null): () => void {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempt = () => {
    timer = null;
    const chat = currentAssistantChat(preferredServerId);
    if (chat && focusChatComposer(chat.serverId, chat.agentId)) return;
    if (Date.now() - startedAt < FOCUS_GIVE_UP_MS) timer = setTimeout(attempt, FOCUS_RETRY_MS);
  };
  timer = setTimeout(attempt, FOCUS_RETRY_MS);
  return () => {
    if (timer) clearTimeout(timer);
  };
}

/**
 * Handles the pending request while `enabled` (the screen has the focus) and `workspaceKey` names
 * the workspace whose Explorer the screen shows. `onRevealed` lets the Desk open the sidebar for
 * its focused tab.
 */
export function useAssistantSidebarReveal(input: {
  workspaceKey: string | null;
  enabled: boolean;
  onRevealed?: () => void;
}): void {
  const isCompact = useIsCompactFormFactor();
  const layoutHydrated = useWorkspaceLayoutStoreHydrated();
  const requestSeq = useAssistantSidebarStore((state) => state.requestSeq);
  const onRevealedRef = useRef(input.onRevealed);
  onRevealedRef.current = input.onRevealed;
  const workspaceKey = input.workspaceKey;
  const enabled = input.enabled && layoutHydrated;
  useEffect(() => {
    const store = useAssistantSidebarStore.getState();
    if (!enabled || !workspaceKey || requestSeq <= store.handledSeq) return;
    store.markHandled(requestSeq);
    revealAssistantTab({ workspaceKey, isCompact });
    onRevealedRef.current?.();
    // A keyboard popping up on a phone is not wanted; on a pointer layout the user came to write.
    if (!store.focusComposer || !isWeb || isCompact) return;
    return focusComposerSoon(workspaceKey.slice(0, workspaceKey.indexOf(":")));
  }, [enabled, isCompact, requestSeq, workspaceKey]);
}
