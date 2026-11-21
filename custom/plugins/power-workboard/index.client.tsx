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
  splitTaskReport,
} from "./shared/task-report";
// CUSTOM(assistant-reply-protocol)
import { AssistantReplyItem } from "./client/assistant/AssistantReplyCard";
import {
  PmSidebarDecisionsBadge,
  PmSidebarDecisionsView,
} from "./client/assistant/pm-board/PmSidebarDecisions"; // CUSTOM(pm-sidebar-decisions)
import { pmBoardStrings } from "./client/assistant/pm-board/pm-board-strings";
import { readPaseoLocale } from "./client/paseo-language";
import { setScreenOpener } from "./client/assistant/nav";
import {
  REPLY_ITEM_KIND,
  REPLY_ITEM_VERSION,
  replyItemDataSchema,
  replyTimelineItems,
} from "./shared/reply-protocol";

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

// CUSTOM(workboard-inner-pages): the Project Manager chat, dashboard, conversations and reports
// are tabs inside WorkboardScreen, not surfaces of their own (they were Desk chips before).

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface("power-workboard", Surface);
  const removeRestartPill = contributeRestartChatPill(client); // CUSTOM(assistant-restart-pill)
  const removeSidebar = client.addSidebarItem({
    id: "power-workboard",
    title: "Workboard",
    icon: "Workflow",
    surface: "power-workboard",
  });
  const removeSettings = client.addSettingsScreen({
    id: "power-workboard-settings",
    title: "Workboard",
    icon: "Settings",
    Component: SettingsSurface,
  });
  // CUSTOM(workboard-tab)
  const removePanel = client.addWorkspacePanel({
    id: "power-workboard",
    title: "Workboard",
    icon: "Workflow",
    context: "workspace",
    locations: ["workspace"],
    Component: PanelSurface,
  });
  const removeTabCommand = client.addCommandCenterItem({
    id: "power-workboard-open-tab",
    title: "Open Workboard tab",
    icon: "Workflow",
    keywords: ["power", "workboard", "orchestrator", "kanban", "tab"],
    context: "workspace",
    onSelect: ({ openPanel }) => openPanel("power-workboard"),
  });
  const removeCommand = client.addCommandCenterItem({
    id: "power-workboard-open",
    title: "Workboard",
    icon: "Workflow",
    keywords: ["power", "workboard", "orchestrator", "tasks"],
    context: "global",
    onSelect: (context) => context.openSurface("power-workboard"),
  });
  // CUSTOM(assistant-reports): Projects Reports from anywhere, as a full page.
  // CUSTOM(workboard-inner-pages): the Workboard page on its Reports tab. The pinned plugin
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
      "Workboard: close this refinement and write the ticket into the task.",
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
          title: "Project Manager",
          side: "left",
          priority: 100,
          agentLabel: ASSISTANT_CHAT_LABEL,
          Component: QuickStatusBarItem,
        })
      : host.addSidebarFooterItem?.({
          id: "projects-assistant-status",
          title: "Project Manager status",
          Component: QuickStatusItem,
        })) ?? (() => {});
  // CUSTOM(pm-sidebar-decisions): the PM chat's "Decisions" view in the right sidebar, with the
  // open-decision count as a badge. Hosts without the slot skip it. The pinned types predate it.
  const removeDecisionsView =
    (
      client as unknown as {
        addAssistantSidebarView?(view: {
          id: string;
          title: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Component: ComponentType<any>;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Badge?: ComponentType<any>;
        }): () => void;
      }
    ).addAssistantSidebarView?.({
      id: "pm-decisions",
      title: pmBoardStrings(readPaseoLocale()).sidebarTitle,
      Component: PmSidebarDecisionsView,
      Badge: PmSidebarDecisionsBadge,
    }) ?? (() => {});
  const removeAssistantCommand = client.addSlashCommand({
    name: "assistant",
    description: "Project Manager: send this message without leaving this chat",
    argumentHint: "<message>",
    context: "agent",
    async onSubmit({ args, rpc }) {
      if (!args.trim()) throw new Error("Write the message after /assistant");
      await rpc(assistantAskRpc, { text: args, source: "slash", waitMs: 0 });
    },
  });
  // CUSTOM(assistant-reply-protocol): a reply ending in a ```pwb block becomes one item, only in
  // the Project Manager's chat: the host passes the chat's agent to the transformer
  // (CUSTOM(timeline-transformer-agent)), which the pinned plugin types lack, hence the cast.
  // Other agents keep the reply as Markdown. Registered before the report card, since the host uses
  // the first transformer that answers. Ids in the block open the board through the client's
  // `openScreen`, also missing from the pinned types.
  setScreenOpener(
    (
      client as unknown as {
        openScreen?(input: {
          screenId: string;
          params?: Record<string, string>;
        }): void;
      }
    ).openScreen?.bind(client) ?? null,
  );
  const removeReplyTransformer = client.addTimelineTransformer({
    id: "assistant-reply",
    query: { itemType: "assistant_message" },
    transform: (input) => {
      const { item } = input;
      // A reply that also carries a valid `<report>` keeps its report card.
      if (splitTaskReport(item.text)) return undefined;
      const { agent } = input as {
        agent?: { labels: Readonly<Record<string, string>> };
      };
      const items = replyTimelineItems(item.text, agent?.labels);
      return items ? { items } : undefined;
    },
  });
  const removeReplyRenderer = client.addTimelineRenderer({
    kind: REPLY_ITEM_KIND,
    version: REPLY_ITEM_VERSION,
    schema: replyItemDataSchema,
    Component: AssistantReplyItem,
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
    removeReplyRenderer(); // CUSTOM(assistant-reply-protocol)
    removeReplyTransformer();
    setScreenOpener(null);
    removeReportText();
    removeReportCard();
    removeReportTransformer();
    removeDecisionsView(); // CUSTOM(pm-sidebar-decisions)
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
