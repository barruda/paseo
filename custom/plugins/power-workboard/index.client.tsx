import type {
  PluginClientContext,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./client/query-client";
import { WorkboardScreen } from "./client/WorkboardScreen";
import { writeTicketRpc } from "./shared/rpc";
// CUSTOM(projects-assistant)
import { ChatLauncher } from "./client/assistant/ChatLauncher";
import { ConversationsScreen } from "./client/assistant/ConversationsScreen";
import { contributeRestartChatPill } from "./client/assistant/RestartChatPill"; // CUSTOM(assistant-restart-pill)
import { QuickStatusItem } from "./client/assistant/QuickStatus"; // CUSTOM(assistant-quick)
import { assistantAskRpc } from "./shared/assistant-rpc";
import { DashboardScreen } from "./client/assistant/DashboardScreen";
import {
  CHAT_SURFACE_ID,
  CONVERSATIONS_SURFACE_ID,
  DASHBOARD_SURFACE_ID,
} from "./client/assistant/nav";

const Surface = (props: Parameters<typeof WorkboardScreen>[0]) => (
  <QueryClientProvider client={queryClient}>
    <WorkboardScreen {...props} />
  </QueryClientProvider>
);
// CUSTOM(workboard-tab): the board as a workspace tab, from the "+" new-tab menu or the Command
// Center. It shows the whole board, not just this workspace's tasks.
const PanelSurface = (props: PluginWorkspacePanelProps) => (
  <QueryClientProvider client={queryClient}>
    <WorkboardScreen {...props} />
  </QueryClientProvider>
);
const SettingsSurface = (props: Parameters<typeof WorkboardScreen>[0]) => (
  <QueryClientProvider client={queryClient}>
    <WorkboardScreen {...props} initialPage="settings" />
  </QueryClientProvider>
);

// CUSTOM(projects-assistant): Tasks mode only. The Desk header opens these as chips
// (packages/app/src/task-navigation/desk-workboard.tsx); they have no sidebar item or tab.
const DashboardSurface = (props: Parameters<typeof DashboardScreen>[0]) => (
  <QueryClientProvider client={queryClient}>
    <DashboardScreen {...props} />
  </QueryClientProvider>
);
const ConversationsSurface = (
  props: Parameters<typeof ConversationsScreen>[0],
) => (
  <QueryClientProvider client={queryClient}>
    <ConversationsScreen {...props} />
  </QueryClientProvider>
);

const ChatSurface = (props: Parameters<typeof ChatLauncher>[0]) => (
  <QueryClientProvider client={queryClient}>
    <ChatLauncher {...props} />
  </QueryClientProvider>
);

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface("power-workboard", Surface);
  // CUSTOM(projects-assistant)
  const removeDashboard = client.addSurface(
    DASHBOARD_SURFACE_ID,
    DashboardSurface,
  );
  const removeConversations = client.addSurface(
    CONVERSATIONS_SURFACE_ID,
    ConversationsSurface,
  );
  const removeChat = client.addSurface(CHAT_SURFACE_ID, ChatSurface);
  const removeRestartPill = contributeRestartChatPill(client); // CUSTOM(assistant-restart-pill)
  const removeSidebar = client.addSidebarItem({
    id: "power-workboard",
    title: "Power Workboard",
    icon: "Workflow",
    surface: "power-workboard",
  });
  const removeSettings = client.addSettingsScreen({
    id: "power-workboard-settings",
    title: "Power Workboard",
    icon: "Settings",
    Component: SettingsSurface,
  });
  // CUSTOM(workboard-tab)
  const removePanel = client.addWorkspacePanel({
    id: "power-workboard",
    title: "Power Workboard",
    icon: "Workflow",
    context: "workspace",
    locations: ["workspace"],
    Component: PanelSurface,
  });
  const removeTabCommand = client.addCommandCenterItem({
    id: "power-workboard-open-tab",
    title: "Open Power Workboard tab",
    icon: "Workflow",
    keywords: ["power", "workboard", "orchestrator", "kanban", "tab"],
    context: "workspace",
    onSelect: ({ openPanel }) => openPanel("power-workboard"),
  });
  const removeCommand = client.addCommandCenterItem({
    id: "power-workboard-open",
    title: "Power Workboard",
    icon: "Workflow",
    keywords: ["power", "workboard", "orchestrator", "tasks"],
    context: "global",
    onSelect: (context) => context.openSurface("power-workboard"),
  });
  const removeWriteTicket = client.addSlashCommand({
    name: "write-ticket",
    description:
      "Power Workboard: close this refinement and write the ticket into the task.",
    argumentHint: "[what to focus on]",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      await rpc(writeTicketRpc, { agentId: agent.id, focus: args });
    },
  });
  // CUSTOM(assistant-quick): the status row in the sidebar footer and `/assistant`. The pinned
  // plugin types predate addSidebarFooterItem, hence the cast.
  const removeStatus =
    (
      client as unknown as {
        addSidebarFooterItem?(item: {
          id: string;
          title: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Component: ComponentType<any>;
        }): () => void;
      }
    ).addSidebarFooterItem?.({
      id: "projects-assistant-status",
      title: "Projects Assistant status",
      Component: QuickStatusItem,
    }) ?? (() => {});
  const removeAssistantCommand = client.addSlashCommand({
    name: "assistant",
    description:
      "Projects Assistant: send this message to the assistant without leaving this chat",
    argumentHint: "<message>",
    context: "agent",
    async onSubmit({ args, rpc }) {
      if (!args.trim()) throw new Error("Write the message after /assistant");
      await rpc(assistantAskRpc, { text: args, source: "slash", waitMs: 0 });
    },
  });
  return () => {
    removeAssistantCommand();
    removeStatus();
    removeWriteTicket();
    removeTabCommand();
    removePanel();
    removeCommand();
    removeSettings();
    removeSidebar();
    removeRestartPill(); // CUSTOM(assistant-restart-pill)
    removeChat();
    removeConversations();
    removeDashboard();
    removeSurface();
  };
}
