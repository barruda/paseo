import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ToastApi } from "@/components/toast-host";
import { usePluginClientSlashCommands } from "@/plugins/client-slash-commands";
import {
  executePluginClientSlashCommand,
  resolvePluginClientSlashCommand,
} from "@/plugins/client-slash-commands/model";

// CUSTOM(chat-code-run): lets markdown code blocks in an agent's chat run their command through
// the same path the composer uses for `!<command>` (the shell-command plugin's `sh` command).
// Without this provider (markdown outside a chat, read-only subagent views) there is no Run button.
type RunChatCommand = (command: string) => void;

const ChatCodeRunContext = createContext<RunChatCommand | null>(null);

// CUSTOM(chat-file-actions): the chat's host and workspace, for the file link actions that open a
// Warp tab. Null outside an agent panel.
export interface ChatWorkspace {
  serverId: string;
  workspaceId: string;
}

const ChatWorkspaceContext = createContext<ChatWorkspace | null>(null);

export function useChatWorkspace(): ChatWorkspace | null {
  return useContext(ChatWorkspaceContext);
}

/**
 * Runs a command in the agent's directory as if `!<command>` was typed in its composer. Null when
 * the shell-command plugin is not installed on the agent's daemon. Also used by commit-wip.
 */
export function useRunChatCommand({
  serverId,
  workspaceId,
  agentId,
  toast,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  agentId: string | null | undefined;
  toast?: ToastApi | null;
}): RunChatCommand | null {
  const commands = usePluginClientSlashCommands({
    serverId,
    workspaceId: agentId ? workspaceId : null,
    agentId: agentId ?? "",
  });
  const canRun = useMemo(
    () =>
      resolvePluginClientSlashCommand({ text: "!true", hasAttachments: false, commands }) !== null,
    [commands],
  );
  const run = useCallback<RunChatCommand>(
    (command) => {
      const resolved = resolvePluginClientSlashCommand({
        text: `!${command}`,
        hasAttachments: false,
        commands,
      });
      if (!resolved) return;
      executePluginClientSlashCommand({
        command: resolved.command,
        args: resolved.args,
        onError(error) {
          console.error("[ChatCodeRun] Failed to run command:", error);
          toast?.error(error instanceof Error ? error.message : String(error));
        },
      });
    },
    [commands, toast],
  );
  return canRun ? run : null;
}

export function ChatCodeRunProvider({
  serverId,
  workspaceId,
  agentId,
  toast,
  children,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  agentId: string | null | undefined;
  toast?: ToastApi | null;
  children: ReactNode;
}) {
  const run = useRunChatCommand({ serverId, workspaceId, agentId, toast });
  const workspace = useMemo(
    () => (workspaceId ? { serverId, workspaceId } : null),
    [serverId, workspaceId],
  );
  return (
    <ChatWorkspaceContext.Provider value={workspace}>
      <ChatCodeRunContext.Provider value={run}>{children}</ChatCodeRunContext.Provider>
    </ChatWorkspaceContext.Provider>
  );
}

export function useChatCodeRun(): RunChatCommand | null {
  return useContext(ChatCodeRunContext);
}
