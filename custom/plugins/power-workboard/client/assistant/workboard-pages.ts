// CUSTOM(workboard-inner-pages): the Project Manager pages (chat, dashboard, conversations,
// reports) as tabs inside the Workboard, after Board and Orchestrators. They used to be Desk
// chips of their own; the Desk now shows only Workboard and passes the inner tab to keep as
// `params.tab`.
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { PageLocale } from "../paseo-language";
import {
  CHAT_SURFACE_ID,
  CONVERSATIONS_SURFACE_ID,
  DASHBOARD_SURFACE_ID,
  PM_BOARD_SURFACE_ID,
  REPORTS_SURFACE_ID,
} from "./nav";

type Navigation = PluginSurfaceProps["navigation"];

export type WorkboardPageTab =
  | "pm-board"
  | "assistant-chat"
  | "dashboard"
  | "conversations"
  | "reports";

export interface WorkboardPage {
  tab: WorkboardPageTab;
  /** The surface id other code still names the page by (links, the Desk's old chips). */
  surfaceId: string;
  icon: string;
}

export const WORKBOARD_PAGES: readonly WorkboardPage[] = [
  // CUSTOM(pm-board): the PM's own board, right after Board, apart from the code tasks.
  { tab: "pm-board", surfaceId: PM_BOARD_SURFACE_ID, icon: "Scale" },
  { tab: "assistant-chat", surfaceId: CHAT_SURFACE_ID, icon: "MessageSquare" },
  {
    tab: "dashboard",
    surfaceId: DASHBOARD_SURFACE_ID,
    icon: "LayoutDashboard",
  },
  {
    tab: "conversations",
    surfaceId: CONVERSATIONS_SURFACE_ID,
    icon: "MessagesSquare",
  },
  { tab: "reports", surfaceId: REPORTS_SURFACE_ID, icon: "FileText" },
];

const en: Record<WorkboardPageTab, string> = {
  "pm-board": "Decisions",
  "assistant-chat": "Project Manager",
  dashboard: "Dashboard",
  conversations: "Conversations",
  reports: "Reports",
};
const pt: Record<WorkboardPageTab, string> = {
  "pm-board": "Decisões",
  "assistant-chat": "Project Manager",
  dashboard: "Painel",
  conversations: "Conversas",
  reports: "Relatórios",
};
const zh: Record<WorkboardPageTab, string> = {
  "pm-board": "决策",
  "assistant-chat": "Project Manager",
  dashboard: "仪表板",
  conversations: "对话",
  reports: "报告",
};

export function workboardPageLabels(
  locale: PageLocale,
): Record<WorkboardPageTab, string> {
  return locale === "pt" ? pt : locale === "zh" ? zh : en;
}

export function isWorkboardPageTab(tab: string): tab is WorkboardPageTab {
  return WORKBOARD_PAGES.some((page) => page.tab === tab);
}

export function pageTabForSurface(surfaceId: string): WorkboardPageTab | null {
  return (
    WORKBOARD_PAGES.find((page) => page.surfaceId === surfaceId)?.tab ?? null
  );
}

/**
 * Tabs a host may ask for and remember. Orchestrator tabs are left out (they close with the
 * board), and so is the assistant chat: it opens the chat agent and hands back the tab it came
 * from, so remembering it would reopen the chat every time the board shows.
 */
export function isRestorableTab(tab: string): boolean {
  return (
    tab === "board" ||
    tab === "orchestrators" ||
    (isWorkboardPageTab(tab) && tab !== "assistant-chat")
  );
}

/**
 * The tab the host asks for in `params.tab` (the Desk, or a Command Center item's route). Never
 * the assistant chat, for the reason in `isRestorableTab`.
 */
export function requestedTab(params: unknown): string | null {
  const tab = (params as { tab?: unknown } | undefined)?.tab;
  return typeof tab === "string" && isRestorableTab(tab) ? tab : null;
}

/**
 * Changes whenever the host asks again: the tab plus `params.request`, a value a caller makes
 * unique (the Command Center item) so a repeated open of the same route switches back to the tab.
 */
export function tabRequestKey(params: unknown): string | null {
  const tab = requestedTab(params);
  if (!tab) return null;
  const request = (params as { request?: unknown }).request;
  return typeof request === "string" ? `${tab}#${request}` : tab;
}

/** Tells the Desk the board's tab; other hosts don't take it. */
export function reportTab(navigation: Navigation, tab: string): void {
  if (!isRestorableTab(tab)) return;
  (
    navigation as { setDeskWorkboardTab?: (tab: string) => void } | undefined
  )?.setDeskWorkboardTab?.(tab);
}

/**
 * The navigation the pages get inside the board: `openDeskSurface` with a page's surface id
 * switches the board's tab, in any host. Other ids go to the host's own `openDeskSurface`.
 */
export function withPageNavigation(
  navigation: Navigation,
  select: (tab: WorkboardPageTab) => void,
): Navigation {
  if (!navigation) return navigation;
  const host = (navigation as { openDeskSurface?: (id: string) => void })
    .openDeskSurface;
  const openDeskSurface = (id: string) => {
    const tab = pageTabForSurface(id);
    if (tab) select(tab);
    else host?.(id);
  };
  return { ...navigation, openDeskSurface } as Navigation;
}
