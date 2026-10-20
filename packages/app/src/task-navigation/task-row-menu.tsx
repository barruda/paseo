// CUSTOM(task-context-menu): right-clicking a task offers the workspace row's actions, with
// rename and archive acting on the session instead of the workspace.
import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { SidebarWorkspaceContextMenu } from "@/components/sidebar/sidebar-workspace-menu";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useWorkspaceClipboardActions } from "@/hooks/use-workspace-clipboard-actions";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { markWorkspaceUnread } from "@/workspace/mark-unread";
import type { TaskNode } from "./model";
import { usePinnedTasksStore } from "./pinned-tasks-store";

export interface TaskRowActions {
  copyPath(entry: SidebarWorkspaceEntry): void;
  copyBranchName(entry: SidebarWorkspaceEntry): void;
  rename(node: TaskNode): void;
  markAsRead(node: TaskNode): void;
  markAsUnread(node: TaskNode): void;
  archive(node: TaskNode): void;
  togglePin(node: TaskNode): void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** One set of handlers and one rename modal for the whole sidebar. */
export function useTaskRowActions(): { actions: TaskRowActions; modal: ReactNode } {
  const toast = useToast();
  const clipboard = useWorkspaceClipboardActions();
  const { archiveAgent } = useArchiveAgent();
  const [renaming, setRenaming] = useState<TaskNode | null>(null);
  const actions = useMemo<TaskRowActions>(
    () => ({
      copyPath: (entry) => clipboard.copyPath(entry),
      copyBranchName: (entry) => clipboard.copyBranchName(entry),
      rename: setRenaming,
      markAsRead: (node) => {
        const client = getHostRuntimeStore().getClient(node.agent.serverId);
        void client
          ?.clearAgentAttention(node.agent.id)
          .catch((error: unknown) => toast.error(errorMessage(error, "Failed to mark as read")));
      },
      markAsUnread: (node) => {
        void markWorkspaceUnread(node.agent.serverId, node.workspace.workspaceId).catch(
          (error: unknown) => toast.error(errorMessage(error, "Failed to mark as unread")),
        );
      },
      archive: (node) => {
        void archiveAgent({ serverId: node.agent.serverId, agentId: node.agent.id }).catch(
          () => {},
        );
      },
      // CUSTOM(task-pins)
      togglePin: (node) => usePinnedTasksStore.getState().togglePin(node.key),
    }),
    [archiveAgent, clipboard, toast],
  );
  const close = useCallback(() => setRenaming(null), []);
  const submit = useCallback(
    async (value: string) => {
      if (!renaming) return;
      const client = getHostRuntimeStore().getClient(renaming.agent.serverId);
      if (!client) throw new Error("Host is disconnected");
      await client.updateAgent(renaming.agent.id, { name: value.trim() });
    },
    [renaming],
  );
  const modal = (
    <AdaptiveRenameModal
      key={renaming?.key ?? "none"}
      visible={renaming !== null}
      title="Rename session"
      initialValue={renaming?.agent.title ?? ""}
      placeholder="Session name"
      submitLabel="Save"
      onClose={close}
      onSubmit={submit}
      testID="task-rename-modal"
    />
  );
  return { actions, modal };
}

type TriggerProps = Omit<
  ComponentProps<typeof SidebarWorkspaceContextMenu>,
  | "workspace"
  | "workspaceKey"
  | "contextMenuOpen"
  | "onContextMenuOpenChange"
  | "onCopyPath"
  | "onCopyBranchName"
  | "onRename"
  | "onMarkAsRead"
  | "onMarkAsUnread"
  | "onArchive"
  | "archiveLabel"
  | "isPinned"
  | "onTogglePin"
  | "pinLabel"
  | "openInFileManagerPath"
>;

export function TaskRowContextMenu({
  node,
  entry,
  archived,
  canMarkUnread,
  pinned,
  actions,
  children,
  ...triggerProps
}: TriggerProps & {
  node: TaskNode;
  entry: SidebarWorkspaceEntry;
  archived: boolean;
  canMarkUnread: boolean;
  pinned: boolean;
  actions: TaskRowActions;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const copyPath = useCallback(() => actions.copyPath(entry), [actions, entry]);
  const copyBranchName = useCallback(() => actions.copyBranchName(entry), [actions, entry]);
  const rename = useCallback(() => actions.rename(node), [actions, node]);
  const markAsRead = useCallback(() => actions.markAsRead(node), [actions, node]);
  const markAsUnread = useCallback(() => actions.markAsUnread(node), [actions, node]);
  const archive = useCallback(() => actions.archive(node), [actions, node]);
  const togglePin = useCallback(() => actions.togglePin(node), [actions, node]);
  return (
    <SidebarWorkspaceContextMenu
      {...triggerProps}
      contextMenuOpen={open}
      onContextMenuOpenChange={setOpen}
      workspace={entry}
      workspaceKey={`task-${node.key}`}
      onCopyPath={copyPath}
      onCopyBranchName={entry.projectKind === "git" ? copyBranchName : undefined}
      onRename={rename}
      renameLabel="Rename session"
      onMarkAsRead={!archived && node.agent.requiresAttention ? markAsRead : undefined}
      onMarkAsUnread={!archived && canMarkUnread ? markAsUnread : undefined}
      onArchive={archived ? undefined : archive}
      archiveLabel="Archive session"
      isPinned={pinned}
      onTogglePin={archived ? undefined : togglePin}
      pinLabel="Pin"
      openInFileManagerPath={entry.workspaceDirectory}
    >
      {children}
    </SidebarWorkspaceContextMenu>
  );
}
