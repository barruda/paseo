// CUSTOM(projects-assistant): state shared by the Projects Dashboard, Conversations and Reports
// pages, now tabs of the Workboard (CUSTOM(workboard-inner-pages)). They come from this
// plugin's bundle, so a module-level store is enough to hand the selected agent between them.
// The surface ids below name the pages; they are no longer surfaces of their own.
import { useSyncExternalStore } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

export const DASHBOARD_SURFACE_ID = "projects-dashboard";
export const CONVERSATIONS_SURFACE_ID = "projects-conversations";
export const REPORTS_SURFACE_ID = "projects-reports"; // CUSTOM(assistant-reports)
export const CHAT_SURFACE_ID = "projects-assistant-chat"; // CUSTOM(projects-assistant)
export const PM_BOARD_SURFACE_ID = "projects-pm-board"; // CUSTOM(pm-board)

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
 * The Workboard gives its pages a `navigation.openDeskSurface` that switches its tab
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

/** Opens the Workboard on its Reports tab with this ticket. False when the host can't. */
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

/** Opens the Workboard on its board with this ticket in the side panel. False when the host can't. */
export function openTaskPanel(taskId: string): boolean {
  if (!screenOpener) return false;
  screenOpener({
    screenId: "power-workboard",
    params: {
      tab: "board",
      request: String(Date.now()),
      task: taskId,
    },
  });
  return true;
}

export function canOpenTaskPanel(): boolean {
  return screenOpener !== null;
}
/**
 * CUSTOM(packages): opens the task board with these tickets selected and the package menu open,
 * so the PM's grouping suggestion only marks the tickets; it never creates the package.
 */
export function openBoardSelection(taskIds: readonly string[]): boolean {
  if (!screenOpener || !taskIds.length) return false;
  screenOpener({
    screenId: "power-workboard",
    params: {
      tab: "board",
      request: String(Date.now()),
      select: taskIds.join(","),
      packageMenu: "1",
    },
  });
  return true;
}

// CUSTOM(pm-board): open the Decisões tab on one card, from a reply's `[pm:<id>]` or a link.
interface PmCardRequest {
  cardId: string;
  seq: number;
}

let pmCardRequest: PmCardRequest | null = null;
let pmCardSeq = 0;

/** Ask the Decisões page to show a card. It may mount only after this, so the request waits. */
export function requestPmCard(cardId: string): void {
  pmCardRequest = { cardId, seq: ++pmCardSeq };
  for (const listener of listeners) listener();
}

/** Called by the page once it showed the card, so a later visit starts fresh. */
export function consumePmCardRequest(seq: number): void {
  if (pmCardRequest?.seq !== seq) return;
  pmCardRequest = null;
  for (const listener of listeners) listener();
}

export function usePmCardRequest(): PmCardRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => pmCardRequest,
    () => pmCardRequest,
  );
}

/** Opens the Workboard on its Decisões tab with this card. False when the host can't. */
export function openPmCard(cardId: string): boolean {
  if (!screenOpener) return false;
  requestPmCard(cardId);
  screenOpener({
    screenId: "power-workboard",
    params: { tab: "pm-board", request: String(Date.now()) },
  });
  return true;
}

export function canOpenPmCard(): boolean {
  return screenOpener !== null;
}

// CUSTOM(assistant-desk): the chat opens in the app's Project Manager Desk, which reuses one
// tab for it. The flag tells the app it is the chat even before its session lists the
// agent (a chat created a moment ago); the pinned plugin types lack it, hence the cast.
type OpenAgentWithSidebar = (input: {
  agentId: string;
  serverId?: string;
  assistantSidebar?: boolean;
}) => void;

/** Opens the Project Manager chat in the app's Project Manager Desk. */
export function openAssistantChat(
  navigation: Pick<NonNullable<PluginSurfaceProps["navigation"]>, "openAgent">,
  agentId: string,
): void {
  (navigation.openAgent as OpenAgentWithSidebar)({
    agentId,
    assistantSidebar: true,
  });
}
