// CUSTOM(desks): tab menu actions shared by the workspace screen and Desks, so a tab menu
// action is written once and works wherever the standard tab row is rendered.
import * as Clipboard from "expo-clipboard";
import type { TFunction } from "i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ToastApi } from "@/components/toast-host";
import { getDesktopHost } from "@/desktop/host";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildProviderCommand } from "@/utils/provider-command-templates";
import { isAbsolutePath } from "@/utils/path";
import { homeFromListedPath, isHomeRelativePath, resolveTabFilePath } from "./tab-file-path";

interface Feedback {
  toast: ToastApi;
  t: TFunction;
}

async function copy(text: string, copiedLabel: string, { toast, t }: Feedback) {
  try {
    await Clipboard.setStringAsync(text);
    toast.copied(copiedLabel);
  } catch {
    toast.error(t("workspace.tabs.toasts.copyFailed"));
  }
}

export async function copyTabAgentId(agentId: string, feedback: Feedback) {
  if (!agentId) return;
  await copy(agentId, feedback.t("workspace.tabs.toasts.agentIdCopiedLabel"), feedback);
}

export async function copyTabTerminalId(terminalId: string, feedback: Feedback) {
  if (!terminalId) return;
  await copy(terminalId, feedback.t("workspace.tabs.toasts.terminalIdCopiedLabel"), feedback);
}

const hostHomes = new Map<string, string>();

/** The daemon host's home directory, cached per host. Null when the daemon can't tell. */
async function getHostHome(serverId: string, workspaceDirectory: string): Promise<string | null> {
  const cached = hostHomes.get(serverId);
  if (cached) return cached;
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) return null;
  try {
    const listing = await client.listDirectory(workspaceDirectory, "~");
    const home = homeFromListedPath(listing.path, workspaceDirectory);
    if (home) hostHomes.set(serverId, home);
    return home;
  } catch {
    return null;
  }
}

/**
 * The tab's absolute path on its host; null (after a toast) when it can't be resolved. Also used
 * by the chat's file link actions (chat-file-actions).
 */
export async function resolveFullTabFilePath(
  input: { path: string; serverId?: string; workspaceDirectory: string | null } & Feedback,
): Promise<string | null> {
  const { path, serverId, workspaceDirectory, toast, t } = input;
  if (isAbsolutePath(path)) return path;
  if (!workspaceDirectory) {
    toast.error(t("workspace.header.toasts.workspacePathUnavailable"));
    return null;
  }
  const home =
    isHomeRelativePath(path) && serverId ? await getHostHome(serverId, workspaceDirectory) : null;
  const resolved = resolveTabFilePath({ path, workspaceDirectory, home });
  if (!resolved) toast.error("Could not resolve ~ on this host");
  return resolved;
}

/** "full" resolves the tab's path against the workspace root (copy-full-file-path). */
export async function copyTabFilePath(
  input: {
    path: string;
    mode?: "full";
    serverId?: string;
    workspaceDirectory: string | null;
  } & Feedback,
) {
  const { path, mode } = input;
  if (!path) return;
  const copiedPath = mode === "full" ? await resolveFullTabFilePath(input) : path;
  if (!copiedPath) return;
  await copy(copiedPath, input.t("workspace.tabs.toasts.filePathCopiedLabel"), input);
}

let fileOpenPending = false;

/** Opens a local file with the desktop opener (open-file-externally); null when unavailable. */
export function createTabFileOpener(isLocalFileHost: boolean) {
  const openFile = getDesktopHost()?.opener?.openFile;
  if (!isLocalFileHost || !openFile) return null;
  return async (
    input: {
      path: string;
      mode: "browser" | "default";
      serverId?: string;
      workspaceDirectory: string | null;
    } & Feedback,
  ) => {
    const { mode, toast } = input;
    if (fileOpenPending) return;
    const absolutePath = await resolveFullTabFilePath(input);
    if (!absolutePath) return;
    fileOpenPending = true;
    toast.show("Opening file…", { durationMs: null });
    try {
      await openFile({ path: absolutePath, mode });
      toast.show("File opened");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open file");
    } finally {
      fileOpenPending = false;
    }
  };
}

export async function copyTabResumeCommand(
  input: { serverId: string; agentId: string } & Feedback,
) {
  const { serverId, agentId, toast, t } = input;
  if (!agentId) return;
  const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId) ?? null;
  const providerSessionId = agent?.runtimeInfo?.sessionId ?? agent?.persistence?.sessionId ?? null;
  if (!agent || !providerSessionId) {
    toast.error(t("workspace.tabs.toasts.resumeIdUnavailable"));
    return;
  }
  const command =
    buildProviderCommand({
      provider: agent.provider,
      id: "resume",
      sessionId: providerSessionId,
    }) ?? null;
  if (!command) {
    toast.error(t("workspace.tabs.toasts.resumeCommandUnavailable"));
    return;
  }
  await copy(command, t("workspace.tabs.toasts.resumeCommandCopiedLabel"), input);
}

export async function reloadTabAgent(
  input: {
    client: DaemonClient | null;
    isConnected: boolean;
    serverId: string;
    agentId: string;
  } & Feedback,
) {
  const { client, isConnected, serverId, agentId, toast, t } = input;
  if (!client || !isConnected) {
    toast.error(t("workspace.terminal.hostDisconnected"));
    return;
  }
  toast.show(t("workspace.tabs.toasts.reloadingAgent"), { durationMs: null });
  try {
    await client.refreshAgent(agentId);
    // Send the existing cursor so the server detects the new epoch and
    // returns reset:true. Without a cursor, the server returns reset:false
    // and the client takes the incremental path, where new-epoch rows are
    // dropped against the stale cursor.
    const sessionState = useSessionStore.getState().sessions[serverId];
    const currentCursor = sessionState?.agentTimelineCursor.get(agentId);
    await getHostRuntimeStore().fetchAgentTimeline(serverId, agentId, {
      direction: "tail",
      projection: "projected",
      ...(currentCursor
        ? { cursor: { epoch: currentCursor.epoch, seq: currentCursor.endSeq } }
        : {}),
    });
    toast.show(t("workspace.tabs.toasts.reloadedAgent"), { variant: "success" });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToReloadAgent"),
    );
  }
}
