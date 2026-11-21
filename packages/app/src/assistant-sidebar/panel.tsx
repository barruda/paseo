// CUSTOM(assistant-desk), CUSTOM(pm-sidebar): the Project Manager tab of the Explorer sidebar, the
// chat's default place. It renders the chat (assistantSidebarChat) with the ordinary agent panel
// (history, composer, pwb cards), so a new chat, a compaction or a restart swaps the chat in the
// same Explorer tab. "Open in main area" opens the assistant Desk; nothing else does. While that
// Desk is on screen this tab only says so, with "Show here" to come back (which closes the Desk),
// so the chat never has two composers on screen. See custom/CHANGES.md.
// CUSTOM(pm-sidebar-decisions): plugin views (Power Workboard's open decisions) get a header
// button each; one opens over the chat, which stays mounted underneath so its draft, scroll and
// focus come back with the header's back arrow.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, ListChecks, SquareArrowOutUpRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { AgentConversationPanel } from "@/panels/agent-panel";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { PaneProvider, usePaneContext, type PaneContextValue } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard-store";
import { ASSISTANT_DESK_ID, useDesksStore } from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { resolveAssistantChat, type AssistantChatRef } from "./model";
import { assistantSidebarChat } from "./mirror";
import { openAssistantDesk, openAssistantSidebar } from "./open";
import { assistantAgentMaps } from "./session-agent-maps";
import { useAssistantSidebarStore } from "./store";
import { assistantDeskStrings } from "./strings";
import { ASSISTANT_PANEL_TEST_ID, parkAssistantPanelFocus } from "./focus"; // CUSTOM(header-cycle)
// CUSTOM(pm-sidebar-decisions)
import {
  AssistantSidebarViewBadge,
  AssistantSidebarViewBody,
  useAssistantSidebarViews,
  type AssistantSidebarView,
} from "./plugin-views";
import { SecondaryComposerProvider } from "@/composer/esc-focus-target"; // CUSTOM(chat-esc-focus)

const ThemedBot = withUnistyles(Bot);

// English only, like the other custom surfaces.
const presentation = {
  label: () => "Project Manager",
  subtitle: () => "The Project Manager chat",
  tooltip: () => "Project Manager",
  icon: ThemedBot,
} satisfies PanelPresentation;

const SEPARATOR = "\u0000";
const ignoreRetarget = () => undefined;

function chatKeyOf(chat: AssistantChatRef | null): string {
  return chat ? `${chat.serverId}${SEPARATOR}${chat.agentId}` : "";
}

/** The chat this tab shows, as a stable `serverId\0agentId` key (empty when none). */
function useMirrorChatKey(): string {
  const remembered = useAssistantSidebarStore((state) => state.chat);
  const requestedKey = useAssistantSidebarStore((state) => chatKeyOf(state.requested));
  // assistantAgentMaps returns the same snapshot until an agents map is replaced.
  const maps = useSessionStore((state) => assistantAgentMaps(state.sessions));
  const currentKey = useMemo(
    () =>
      chatKeyOf(
        resolveAssistantChat({
          remembered,
          agentsByServer: maps.agentsByServer,
          preferredServerId: null,
          hydratedServerIds: maps.hydratedServerIds,
        }),
      ),
    [maps, remembered],
  );
  return useDesksStore((state) =>
    chatKeyOf(
      assistantSidebarChat({
        desks: state.desks,
        requested: parseChatKey(requestedKey),
        current: parseChatKey(currentKey),
      }),
    ),
  );
}

/** Whether the Project Manager Desk is on screen (see isAssistantDeskInView). */
function useAssistantDeskInView(): boolean {
  const enabled = useTaskNavigationStore((state) => state.enabled);
  const deskActive = useDesksStore((state) => state.activeDeskId === ASSISTANT_DESK_ID);
  const boardSelected = useDeskWorkboardStore((state) => state.selected !== null);
  return enabled && deskActive && !boardSelected;
}

/**
 * Registers the chat this tab shows with the viewed-timeline sync, which is what fetches and
 * follows its timeline. The workspace and the Desk only publish the agent tabs of their own panes,
 * and this Explorer tab is a `projects_assistant` tab, so without this the chat stays "cold" (a
 * spinner) after the app opens unless another view happens to show it.
 */
function useViewedSidebarChat(chat: AssistantChatRef | null, active: boolean): void {
  const sourceId = `pm-sidebar:${useId()}`;
  const serverId = chat?.serverId ?? "";
  const agentId = active ? (chat?.agentId ?? null) : null;
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  useEffect(() => {
    if (!agentId) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [agentId, serverId]);
  useLayoutEffect(() => {
    if (!agentId || !viewedTimelineSync) return;
    viewedTimelineSync.replaceVisibleAgentIds(sourceId, [agentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(sourceId, []);
  }, [agentId, sourceId, viewedTimelineSync]);
}

function parseChatKey(key: string): AssistantChatRef | null {
  const split = key.indexOf(SEPARATOR);
  if (split < 0) return null;
  return { serverId: key.slice(0, split), agentId: key.slice(split + 1) };
}

/**
 * CUSTOM(pm-sidebar-decisions): which plugin view covers the chat, if any. A view whose plugin
 * goes away falls back to the chat. Opening one parks the chat's focus; closing gives it back.
 */
function useOpenSidebarView(views: readonly AssistantSidebarView[]) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const restoreFocus = useRef<(() => void) | null>(null);
  const open = views.find((entry) => entry.key === openKey) ?? null;
  const show = useCallback((key: string) => {
    restoreFocus.current ??= parkAssistantPanelFocus();
    setOpenKey(key);
  }, []);
  const close = useCallback(() => {
    setOpenKey(null);
    const restore = restoreFocus.current;
    restoreFocus.current = null;
    // After the overlay is gone, so the focus lands on a visible element.
    if (restore) requestAnimationFrame(restore);
  }, []);
  return { open, show, close };
}

/** CUSTOM(pm-sidebar-decisions): a plugin view's header button, its badge after the title. */
function SidebarViewButton({
  entry,
  onShow,
}: {
  entry: AssistantSidebarView;
  onShow: (key: string) => void;
}) {
  const show = useCallback(() => onShow(entry.key), [entry.key, onShow]);
  const badge = useMemo(() => <AssistantSidebarViewBadge entry={entry} />, [entry]);
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={ListChecks}
      onPress={show}
      trailing={badge}
      testID={`projects-assistant-view-${entry.key}`}
    >
      {entry.title}
    </Button>
  );
}

function AssistantSidebarPanel() {
  const pane = usePaneContext();
  const chatKey = useMirrorChatKey();
  const chat = useMemo(() => parseChatKey(chatKey), [chatKey]);
  const chatWorkspaceId = useSessionStore((state) =>
    chat ? state.sessions[chat.serverId]?.agents.get(chat.agentId)?.workspaceId : undefined,
  );
  const { i18n } = useTranslation();
  const strings = assistantDeskStrings(i18n.resolvedLanguage);
  const openDesk = useCallback(() => openAssistantDesk({ chat: chat ?? null }), [chat]);
  const showHere = useCallback(() => void openAssistantSidebar({ chat: chat ?? null }), [chat]);
  const deskInView = useAssistantDeskInView();
  const panelActive = useRetainedPanelActive();
  const views = useAssistantSidebarViews(chat?.serverId ?? null);
  const { open: openView, show: showView, close: closeView } = useOpenSidebarView(views);
  // While the Desk is on screen it shows (and syncs) the chat; this tab shows only a note.
  useViewedSidebarChat(chat, panelActive && !deskInView);

  // Keep the remembered chat in step with what this tab shows, so every other way opens it too.
  useEffect(() => {
    if (chat) useAssistantSidebarStore.getState().setChat(chat);
  }, [chat]);

  const value = useMemo<PaneContextValue | null>(
    () =>
      chat
        ? {
            ...pane,
            serverId: chat.serverId,
            workspaceId: chatWorkspaceId ?? pane.workspaceId,
            target: { kind: "agent", agentId: chat.agentId },
            // Never turn this Explorer tab into an agent tab.
            retargetCurrentTab: ignoreRetarget,
          }
        : null,
    [chat, chatWorkspaceId, pane],
  );

  const openInMain = (
    <View style={styles.bar}>
      {openView ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={ArrowLeft}
          onPress={closeView}
          accessibilityLabel={strings.backToChat}
          testID="projects-assistant-back-to-chat"
        >
          {openView.title}
        </Button>
      ) : null}
      <View style={styles.barSpacer} />
      {views
        .filter((entry) => entry !== openView)
        .map((entry) => (
          <SidebarViewButton key={entry.key} entry={entry} onShow={showView} />
        ))}
      <Button
        variant="ghost"
        size="sm"
        leftIcon={SquareArrowOutUpRight}
        onPress={openDesk}
        testID="projects-assistant-open-main"
      >
        {strings.openInMain}
      </Button>
    </View>
  );
  if (deskInView) {
    return (
      <View style={styles.empty} testID={ASSISTANT_PANEL_TEST_ID}>
        <Text style={styles.emptyText}>{strings.openedInMain}</Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={showHere}
          testID="projects-assistant-show-here"
        >
          {strings.showHere}
        </Button>
      </View>
    );
  }
  if (!value) {
    return (
      <View style={styles.empty} testID={ASSISTANT_PANEL_TEST_ID}>
        <Text style={styles.emptyText}>{strings.noChat}</Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={openDesk}
          testID="projects-assistant-open-desk"
        >
          {strings.openInMain}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.root} testID={ASSISTANT_PANEL_TEST_ID}>
      {openInMain}
      <View style={styles.chat}>
        <View
          style={styles.chat}
          importantForAccessibility={openView ? "no-hide-descendants" : "auto"}
          accessibilityElementsHidden={openView !== null}
        >
          <PaneProvider key={chatKey} value={value}>
            {/* CUSTOM(chat-esc-focus): Esc and the chat's Enter/scroll return to the central composer;
            Esc Esc never stops the Project Manager. CUSTOM(pm-focus): its composer takes the caret
            only when the user opens it (openAssistantSidebar), not on every remount. */}
            <SecondaryComposerProvider interruptsOnEsc={false} autoFocus={false}>
              <AgentConversationPanel />
            </SecondaryComposerProvider>
          </PaneProvider>
        </View>
        {/* CUSTOM(pm-sidebar-decisions): over the chat, not instead of it, so the chat keeps its state. */}
        {openView ? (
          <View style={styles.viewOverlay} testID="projects-assistant-view">
            <AssistantSidebarViewBody key={openView.key} entry={openView} onClose={closeView} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const assistantSidebarPanelRegistration = definePanel("projects_assistant", {
  component: AssistantSidebarPanel,
  presentation,
});

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chat: {
    flex: 1,
    minHeight: 0,
  },
  barSpacer: {
    flex: 1,
  },
  viewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface0,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
