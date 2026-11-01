// CUSTOM(git-sync): the composer's git chips.
// - "Trazer do <worktree>": on a main checkout, one per worktree created from its current branch
//   with commits or uncommitted changes to bring in. Its menu merges the worktree's branch here.
// - "Resolver conflitos": wherever the checkout has unresolved conflicts. It opens a new tab whose
//   draft asks an agent to resolve them, unsent, for the user to review.
// Both sit at the end of the row; a linked worktree's Worktree chip turns into "Resolver
// conflitos" in its own slot instead (see worktree-pill.tsx).
import { GitMerge, TriangleAlert } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRunChatCommand } from "@/chat-code-run/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
} from "@/components/ui/dropdown-menu";
import { PressHighlight } from "@/components/ui/press-highlight";
import { composerPillStyles } from "@/composer/pill-styles";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import {
  bringLabel,
  buildBringWorktreeCommand,
  describeIncoming,
  resolveTrailingGitChips,
  type GitConflicts,
  type IncomingWorktree,
} from "./model";
import { openResolveConflictsTab } from "./open-resolve-tab";
import type { GitSync } from "./use-git-sync";

const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningIcon = (theme: Theme) => ({ color: theme.colors.statusWarning });

const bringTriggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, open }) => [
  composerPillStyles.body,
  (hovered || open) && composerPillStyles.bodyActive,
];

export const ResolveConflictsPill = memo(function ResolveConflictsPill({
  serverId,
  workspaceId,
  agentId,
  conflicts,
  ownCheckout,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  conflicts: GitConflicts;
  /** True when the conflicts are in the agent's own checkout, not in the main checkout. */
  ownCheckout: boolean;
}): ReactElement {
  const toast = useToast();
  const [hovered, setHovered] = useState(false);
  const handlePress = useCallback(() => {
    try {
      openResolveConflictsTab({ serverId, workspaceId, agentId, conflicts, ownCheckout });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [agentId, conflicts, ownCheckout, serverId, toast, workspaceId]);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const bodyStyle = useMemo(
    () => [composerPillStyles.body, styles.conflicts, hovered && styles.conflictsActive],
    [hovered],
  );
  const count = conflicts.files.length;
  return (
    <PressHighlight
      testID="composer-resolve-conflicts-pill"
      accessibilityRole="button"
      accessibilityLabel={`Resolver conflitos: ${count} ${count === 1 ? "arquivo" : "arquivos"} em ${conflicts.dir}`}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <ThemedTriangleAlert size={14} uniProps={warningIcon} />
      <Text style={[composerPillStyles.label, styles.conflictsLabel]}>Resolver conflitos</Text>
    </PressHighlight>
  );
});

const BringWorktreePill = memo(function BringWorktreePill({
  serverId,
  workspaceId,
  agentId,
  incoming,
  onRan,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  incoming: IncomingWorktree;
  onRan: () => void;
}): ReactElement {
  const toast = useToast();
  const run = useRunChatCommand({ serverId, workspaceId, agentId, toast });
  const handleBring = useCallback(() => {
    if (!run) {
      toast.error("Trazer o worktree precisa do plugin shell-command neste host");
      return;
    }
    run(buildBringWorktreeCommand(incoming));
    onRan();
  }, [incoming, onRan, run, toast]);
  const label = bringLabel(incoming);
  const detail = describeIncoming(incoming);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="composer-bring-worktree-pill"
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${detail}`}
        style={bringTriggerStyle}
      >
        {({ hovered, open }) => (
          <>
            <ThemedGitMerge size={14} uniProps={mutedIcon} />
            <Text
              style={[
                composerPillStyles.label,
                (hovered || open) && composerPillStyles.labelActive,
              ]}
            >
              {label}
            </Text>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        minWidth={260}
        side="top"
        testID="composer-bring-worktree-menu"
      >
        <DropdownMenuItem
          onSelect={handleBring}
          description={`${detail} de ${incoming.branch}`}
          testID="composer-bring-worktree-merge"
        >
          {`Fazer merge de ${incoming.branch} aqui`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/** The git chips at the end of the composer row. */
export const GitSyncTrailingPills = memo(function GitSyncTrailingPills({
  serverId,
  workspaceId,
  agentId,
  gitSync,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  gitSync: GitSync;
}): ReactElement | null {
  const chips = resolveTrailingGitChips(gitSync.status);
  if (chips.kind === "resolve") {
    return (
      <ResolveConflictsPill
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={agentId}
        conflicts={chips.conflicts}
        ownCheckout
      />
    );
  }
  if (chips.kind === "bring") {
    return (
      <>
        {chips.incoming.map((incoming) => (
          <BringWorktreePill
            key={incoming.path}
            serverId={serverId}
            workspaceId={workspaceId}
            agentId={agentId}
            incoming={incoming}
            onRan={gitSync.refresh}
          />
        ))}
      </>
    );
  }
  return null;
});

const styles = StyleSheet.create((theme) => ({
  conflicts: {
    borderColor: theme.colors.statusWarning,
  },
  conflictsActive: {
    backgroundColor: theme.colors.statusWarningTint,
  },
  conflictsLabel: {
    color: theme.colors.statusWarning,
  },
}));
