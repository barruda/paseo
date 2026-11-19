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
import {
  ASSISTANT_CHAT_LABEL,
  contributeRestartChatPill,
} from "./client/assistant/RestartChatPill"; // CUSTOM(assistant-restart-pill)
import {
  QuickStatusBarItem, // CUSTOM(status-bar)
  QuickStatusItem,
} from "./client/assistant/QuickStatus"; // CUSTOM(assistant-quick)
import { assistantAskRpc } from "./shared/assistant-rpc";
// CUSTOM(report-card)
import {
  TaskReportCard,
  TaskReportText,
} from "./client/assistant/TaskReportCard";
import {
  REPORT_CARD_KIND,
  REPORT_ITEM_VERSION,
  REPORT_TEXT_KIND,
  reportCardDataSchema,
  reportTextDataSchema,
  reportTimelineItems,
} from "./shared/task-report";

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

// CUSTOM(workboard-inner-pages): the Projects Assistant chat, dashboard, conversations and reports
// are tabs inside WorkboardScreen, not surfaces of their own (they were Desk chips before).

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface("power-workboard", Surface);
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
  // CUSTOM(assistant-reports): Projects Reports from anywhere, as a full page.
  // CUSTOM(workboard-inner-pages): the Power Workboard page on its Reports tab. The pinned plugin
  // types predate `openScreen` with params, hence the cast.
  const removeReportsCommand = client.addCommandCenterItem({
    id: "projects-reports-open",
    title: "Projects Reports",
    icon: "FileText",
    keywords: ["projects", "reports", "assistant", "timeline", "tickets"],
    context: "global",
    onSelect: (context) => {
      const { openScreen } = context as {
        openScreen?(input: {
          screenId: string;
          params?: Record<string, string>;
        }): void;
      };
      if (openScreen)
        openScreen({
          screenId: "power-workboard",
          // `request` makes each open a new request, so a board already on this route that
          // moved to another tab switches back to Reports.
          params: { tab: "reports", request: String(Date.now()) },
        });
      else context.openSurface("power-workboard");
    },
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
  // CUSTOM(assistant-quick): the status row and `/assistant`. CUSTOM(status-bar): the row lives in
  // the app's status bar, leftmost; it owns the assistant chat's status line, so the line under
  // that chat's composer is hidden. Hosts without a status bar get the sidebar footer row. The
  // pinned plugin types predate both, hence the cast.
  const host = client as unknown as {
    addStatusBarItem?(item: {
      id: string;
      title: string;
      side: "left" | "right";
      priority: number;
      agentLabel: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Component: ComponentType<any>;
    }): () => void;
    addSidebarFooterItem?(item: {
      id: string;
      title: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Component: ComponentType<any>;
    }): () => void;
  };
  const removeStatus =
    (host.addStatusBarItem
      ? host.addStatusBarItem({
          id: "projects-assistant-status",
          title: "Projects Assistant",
          side: "left",
          priority: 100,
          agentLabel: ASSISTANT_CHAT_LABEL,
          Component: QuickStatusBarItem,
        })
      : host.addSidebarFooterItem?.({
          id: "projects-assistant-status",
          title: "Projects Assistant status",
          Component: QuickStatusItem,
        })) ?? (() => {});
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
  // CUSTOM(report-card): an agent reply ending in a valid `<report>` block shows a card instead of
  // the raw JSON. Any agent qualifies when the block parses; anything else keeps the reply as is.
  const removeReportTransformer = client.addTimelineTransformer({
    id: "task-report",
    query: { itemType: "assistant_message" },
    transform: ({ item }) => {
      const items = reportTimelineItems(item.text);
      return items ? { items } : undefined;
    },
  });
  const removeReportCard = client.addTimelineRenderer({
    kind: REPORT_CARD_KIND,
    version: REPORT_ITEM_VERSION,
    schema: reportCardDataSchema,
    Component: TaskReportCard,
  });
  const removeReportText = client.addTimelineRenderer({
    kind: REPORT_TEXT_KIND,
    version: REPORT_ITEM_VERSION,
    schema: reportTextDataSchema,
    Component: TaskReportText,
  });
  return () => {
    removeReportText();
    removeReportCard();
    removeReportTransformer();
    removeAssistantCommand();
    removeStatus();
    removeWriteTicket();
    removeTabCommand();
    removePanel();
    removeCommand();
    removeReportsCommand(); // CUSTOM(assistant-reports)
    removeSettings();
    removeSidebar();
    removeRestartPill(); // CUSTOM(assistant-restart-pill)
    removeSurface();
  };
}
