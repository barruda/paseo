// CUSTOM(board-desk-links): links from the Power Workboard's tab bar to the Projects Assistant
// pages. They open the Desk tab of each page, so they only exist where the Desk hosts the board.
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { PageLocale } from "../paseo-language";
import {
  CONVERSATIONS_SURFACE_ID,
  DASHBOARD_SURFACE_ID,
  REPORTS_SURFACE_ID,
  openDeskSurface,
} from "./nav";

export type DeskLinkKey = "dashboard" | "conversations" | "reports";

export interface DeskLink {
  key: DeskLinkKey;
  surfaceId: string;
  icon: string;
}

export const DESK_LINKS: readonly DeskLink[] = [
  {
    key: "dashboard",
    surfaceId: DASHBOARD_SURFACE_ID,
    icon: "LayoutDashboard",
  },
  {
    key: "conversations",
    surfaceId: CONVERSATIONS_SURFACE_ID,
    icon: "MessagesSquare",
  },
  { key: "reports", surfaceId: REPORTS_SURFACE_ID, icon: "FileText" },
];

interface DeskLinkText {
  label: string;
  /** Hover hint and accessibility label. */
  hint: string;
}
type DeskLinkStrings = Record<DeskLinkKey, DeskLinkText>;

const en: DeskLinkStrings = {
  dashboard: { label: "Dashboard", hint: "Open Projects Dashboard" },
  conversations: {
    label: "Conversations",
    hint: "Open Projects Conversations",
  },
  reports: { label: "Reports", hint: "Open Projects Reports" },
};
const pt: DeskLinkStrings = {
  dashboard: { label: "Painel", hint: "Abrir Projects Dashboard" },
  conversations: { label: "Conversas", hint: "Abrir Projects Conversations" },
  reports: { label: "Relatórios", hint: "Abrir Projects Reports" },
};
const zh: DeskLinkStrings = {
  dashboard: { label: "仪表板", hint: "打开 Projects Dashboard" },
  conversations: { label: "对话", hint: "打开 Projects Conversations" },
  reports: { label: "报告", hint: "打开 Projects Reports" },
};

export function deskLinkStrings(locale: PageLocale): DeskLinkStrings {
  return locale === "pt" ? pt : locale === "zh" ? zh : en;
}

/** The Desk passes `openDeskSurface`; the board's workspace tab and sidebar route do not. */
export function canOpenDeskSurfaces(
  navigation: PluginSurfaceProps["navigation"],
): boolean {
  return (
    typeof (navigation as { openDeskSurface?: unknown } | undefined)
      ?.openDeskSurface === "function"
  );
}

/**
 * Opens the page's Desk tab. The Desk keeps one tab per page and `openDeskSurface` selects it, so
 * a second click focuses the same tab.
 */
export function openDeskLink(
  navigation: PluginSurfaceProps["navigation"],
  key: DeskLinkKey,
): boolean {
  const link = DESK_LINKS.find((item) => item.key === key);
  return !!link && openDeskSurface(navigation, link.surfaceId);
}
