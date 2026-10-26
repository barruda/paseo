// CUSTOM(worktree-pill): a "Worktree: <branch>" pill right of Commit: wip, shown only when the
// agent's workspace is a git worktree. Its menu copies the worktree's full path, or commits the
// worktree as "wip" and merges its branch into the main checkout as a `!<command>`
// (shell-command plugin), so the output lands in a Terminal card in the chat.
// CUSTOM(worktree-pill-done): `done` (the agent's status summary says the request is done or
// nearly done) gives it a green border; AgentTracks also moves it to the front of the row.
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRunChatCommand } from "@/chat-code-run/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
} from "@/components/ui/dropdown-menu";
import { composerPillStyles } from "@/composer/pill-styles";
import { MERGE_WORKTREE_COMMAND, resolveWorktreePillLabel } from "@/composer/worktree-pill-model";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

const triggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, open }) => [
  composerPillStyles.body,
  (hovered || open) && composerPillStyles.bodyActive,
];

const doneTriggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, open }) => [
  composerPillStyles.body,
  (hovered || open) && composerPillStyles.bodyActive,
  styles.done,
];

export const WorktreePill = memo(function WorktreePill({
  serverId,
  workspaceId,
  agentId,
  cwd,
  done = false,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  cwd: string;
  done?: boolean;
}): ReactElement | null {
  const toast = useToast();
  const run = useRunChatCommand({ serverId, workspaceId, agentId, toast });
  const worktree = useWorkspaceFields(serverId, workspaceId, (workspace) =>
    workspace.workspaceKind === "worktree"
      ? {
          label: resolveWorktreePillLabel({
            currentBranch: workspace.gitRuntime?.currentBranch,
            workspaceName: workspace.name,
          }),
          directory: workspace.workspaceDirectory || cwd,
        }
      : null,
  );
  const directory = worktree?.directory ?? cwd;
  const handleCopyPath = useCallback(() => {
    Clipboard.setStringAsync(directory)
      .then(() => toast.copied("Worktree path"))
      .catch(() => toast.error("Could not copy the worktree path"));
  }, [directory, toast]);
  const handleMerge = useCallback(() => {
    if (run) run(MERGE_WORKTREE_COMMAND);
    else toast.error("Merging needs the shell-command plugin on this host");
  }, [run, toast]);

  if (!worktree) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="composer-worktree-pill"
        accessibilityRole="button"
        accessibilityLabel={done ? `${worktree.label}, done` : worktree.label}
        style={done ? doneTriggerStyle : triggerStyle}
      >
        {({ hovered, open }) => (
          <Text
            style={[composerPillStyles.label, (hovered || open) && composerPillStyles.labelActive]}
          >
            {worktree.label}
          </Text>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={240} side="top" testID="composer-worktree-menu">
        <DropdownMenuItem onSelect={handleCopyPath} testID="composer-worktree-copy-path">
          Copy worktree full path
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleMerge} testID="composer-worktree-merge">
          Merge back to main project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  done: {
    borderColor: theme.colors.statusSuccess,
  },
}));
