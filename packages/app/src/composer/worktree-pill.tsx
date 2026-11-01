// CUSTOM(worktree-pill): a "Worktree: <branch>" pill right of Commit: wip, shown only when the
// agent's workspace is a git worktree. Its menu copies the worktree's full path, or commits the
// worktree as "wip" and merges its branch into the main checkout as a `!<command>`
// (shell-command plugin), so the output lands in a Terminal card in the chat.
// CUSTOM(worktree-pill-done): `done` (the agent's status summary says the request is done or
// nearly done) gives it a green border; AgentTracks also moves it to the front of the row.
// CUSTOM(worktree-pill-own-project): a worktree opened as its own project (its folder is the
// project root) is told from the main checkout by the checkout's main repo root.
// CUSTOM(worktree-pill-merged): `merged` (done, and the worktree is already merged into the main
// checkout) fills it green and puts a check before the label. New changes in the worktree clear it.
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, type ReactElement } from "react";
import { Check } from "lucide-react-native";
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
import {
  isLinkedWorktreeWorkspace,
  MERGE_WORKTREE_COMMAND,
  resolveWorktreePillLabel,
} from "@/composer/worktree-pill-model";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { resolveWorktreeChipConflicts } from "@/git-sync/model";
import { ResolveConflictsPill } from "@/git-sync/pills";
import type { GitSync } from "@/git-sync/use-git-sync";

const triggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, open }) => [
  composerPillStyles.body,
  (hovered || open) && composerPillStyles.bodyActive,
];

const doneTriggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, open }) => [
  composerPillStyles.body,
  (hovered || open) && composerPillStyles.bodyActive,
  styles.done,
];

const mergedTriggerStyle: DropdownMenuTriggerProps["style"] = () => [
  composerPillStyles.body,
  styles.done,
  styles.merged,
];

function resolveTriggerStyle(done: boolean, merged: boolean): DropdownMenuTriggerProps["style"] {
  if (merged) return mergedTriggerStyle;
  return done ? doneTriggerStyle : triggerStyle;
}

function resolveAccessibilityLabel(label: string, done: boolean, merged: boolean): string {
  if (merged) return `${label}, merged`;
  return done ? `${label}, done` : label;
}

export const WorktreePill = memo(function WorktreePill({
  serverId,
  workspaceId,
  agentId,
  cwd,
  done = false,
  merged = false,
  gitSync,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  cwd: string;
  done?: boolean;
  merged?: boolean;
  /** CUSTOM(git-sync): conflicts here or from merging this worktree turn it into "Resolver conflitos". */
  gitSync?: GitSync;
}): ReactElement | null {
  const toast = useToast();
  const run = useRunChatCommand({ serverId, workspaceId, agentId, toast });
  // CUSTOM(worktree-pill-own-project): the agent's checkout backs up the workspace's, which the
  // app's workspace cache does not keep.
  const agentCheckout = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.projectPlacement?.checkout ?? null;
  });
  const worktree = useWorkspaceFields(serverId, workspaceId, (workspace) => {
    const directory = workspace.workspaceDirectory || cwd;
    if (
      !isLinkedWorktreeWorkspace({
        workspaceKind: workspace.workspaceKind,
        directory,
        projectRootPath: workspace.projectRootPath,
        checkout: workspace.project?.checkout ?? agentCheckout,
      })
    ) {
      return null;
    }
    return {
      label: resolveWorktreePillLabel({
        currentBranch: workspace.gitRuntime?.currentBranch,
        workspaceName: workspace.name,
      }),
      directory,
    };
  });
  const directory = worktree?.directory ?? cwd;
  const handleCopyPath = useCallback(() => {
    Clipboard.setStringAsync(directory)
      .then(() => toast.copied("Worktree path"))
      .catch(() => toast.error("Could not copy the worktree path"));
  }, [directory, toast]);
  const refreshGitSync = gitSync?.refresh;
  const handleMerge = useCallback(() => {
    if (run) {
      run(MERGE_WORKTREE_COMMAND);
      refreshGitSync?.();
    } else toast.error("Merging needs the shell-command plugin on this host");
  }, [refreshGitSync, run, toast]);

  if (!worktree) return null;

  // CUSTOM(git-sync): the same slot becomes "Resolver conflitos" while conflicts are pending.
  const conflicts = resolveWorktreeChipConflicts(gitSync?.status ?? null);
  if (conflicts) {
    return (
      <ResolveConflictsPill
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={agentId}
        conflicts={conflicts}
        ownCheckout={conflicts === gitSync?.status?.conflicts}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="composer-worktree-pill"
        accessibilityRole="button"
        accessibilityLabel={resolveAccessibilityLabel(worktree.label, done, merged)}
        style={resolveTriggerStyle(done, merged)}
      >
        {({ hovered, open }) => (
          <>
            {merged ? <Check size={14} color={styles.mergedIcon.color} /> : null}
            <Text
              style={[
                composerPillStyles.label,
                (hovered || open) && composerPillStyles.labelActive,
                merged && styles.mergedLabel,
              ]}
            >
              {worktree.label}
            </Text>
          </>
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
  merged: {
    backgroundColor: theme.colors.statusSuccessTint,
  },
  mergedLabel: {
    color: theme.colors.statusSuccess,
  },
  mergedIcon: {
    color: theme.colors.statusSuccess,
  },
}));
