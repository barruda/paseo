// CUSTOM(projects-assistant): state shared by the Projects Dashboard, Conversations and Reports
// pages, now tabs of the Power Workboard (CUSTOM(workboard-inner-pages)). They come from this
// plugin's bundle, so a module-level store is enough to hand the selected agent between them.
// The surface ids below name the pages; they are no longer surfaces of their own.
import { useSyncExternalStore } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

export const DASHBOARD_SURFACE_ID = "projects-dashboard";
export const CONVERSATIONS_SURFACE_ID = "projects-conversations";
export const REPORTS_SURFACE_ID = "projects-reports"; // CUSTOM(assistant-reports)
export const CHAT_SURFACE_ID = "projects-assistant-chat"; // CUSTOM(projects-assistant)

interface Selection {
  agentId: string | null;
  taskId: string | null;
}

let selection: Selection = { agentId: null, taskId: null };
const listeners = new Set<() => void>();

export function selectConversation(next: Selection): void {
  selection = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConversationSelection(): Selection {
  return useSyncExternalStore(
    subscribe,
    () => selection,
    () => selection,
  );
}

/**
 * The Power Workboard gives its pages a `navigation.openDeskSurface` that switches its tab
 * (`withPageNavigation` in workboard-pages.ts). It is not in the published plugin types, hence the
 * cast. Returns false when there is no such navigation.
 */
export function openDeskSurface(
  navigation: PluginSurfaceProps["navigation"],
  surfaceId: string,
): boolean {
  const open = (
    navigation as { openDeskSurface?: (id: string) => void } | undefined
  )?.openDeskSurface;
  if (!open) return false;
  open(surfaceId);
  return true;
}

/** Select an agent and show it in Projects Conversations. */
export function showConversation(
  navigation: PluginSurfaceProps["navigation"],
  agentId: string,
  taskId: string | null,
): void {
  selectConversation({ agentId, taskId });
  openDeskSurface(navigation, CONVERSATIONS_SURFACE_ID);
}

interface ReportRequest {
  taskId: string;
  seq: number;
}

let reportRequest: ReportRequest | null = null;

let reportSeq = 0;

/**
 * Ask Projects Reports to show a ticket. The page may mount only after this (the board shows one
 * tab at a time), so the request waits until the page consumes it.
 */
export function requestReportTask(taskId: string): void {
  reportRequest = { taskId, seq: ++reportSeq };
  for (const listener of listeners) listener();
}

/** Called by Projects Reports once it showed the ticket, so a later visit starts fresh. */
export function consumeReportTaskRequest(seq: number): void {
  if (reportRequest?.seq !== seq) return;
  reportRequest = null;
  for (const listener of listeners) listener();
}

export function useReportTaskRequest(): ReportRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => reportRequest,
    () => reportRequest,
  );
}

/** Show a ticket's timeline in Projects Reports. */
export function showReport(
  navigation: PluginSurfaceProps["navigation"],
  taskId: string,
): void {
  requestReportTask(taskId);
  openDeskSurface(navigation, REPORTS_SURFACE_ID);
}

// CUSTOM(assistant-reply-protocol): the client's `openScreen`, set by index.client.tsx, so a chat
// row (timeline items get no navigation) can open the board on a ticket.
type ScreenOpener = (input: {
  screenId: string;
  params?: Record<string, string>;
}) => void;
let screenOpener: ScreenOpener | null = null;

export function setScreenOpener(open: ScreenOpener | null): void {
  screenOpener = open;
}

/** Opens the Power Workboard on its Reports tab with this ticket. False when the host can't. */
export function openTaskReport(taskId: string): boolean {
  if (!screenOpener) return false;
  requestReportTask(taskId);
  // `request` makes each open a new request, so a board already on this route switches back.
  screenOpener({
    screenId: "power-workboard",
    params: { tab: "reports", request: String(Date.now()) },
  });
  return true;
}

export function canOpenTaskReport(): boolean {
  return screenOpener !== null;
}
