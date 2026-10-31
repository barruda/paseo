// CUSTOM(commit-wip): a "Commit: wip" pill right of the diff stat pill. It runs the commit as a
// `!<command>` (shell-command plugin), so the output lands in a Terminal card in the chat. It shows
// always, even with no changes: the diff stat lags behind, and with nothing to commit git just says
// so in the card. While the command runs the pill fades out; a good commit turns it into Git push,
// and a new change in the checkout turns it back (see commit-wip-pill-model.ts).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRunChatCommand } from "@/chat-code-run/context";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  COMMIT_WIP_STEP_COMMAND,
  findLatestShellCommandRun,
  initialCommitWipStep,
  shellCommandOutcome,
  stepAfterRun,
  type CommitWipStep,
} from "@/composer/commit-wip-pill-model";
import { composerPillStyles } from "@/composer/pill-styles";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

/** Keeps the composer track row up even when it has nothing else to show. */
export const COMMIT_WIP_PILL_ALWAYS_SHOWN = true;

const STEP_LABEL: Record<CommitWipStep, string> = { commit: "Commit: wip", push: "Git push" };

interface PendingRun {
  command: string;
  /** The newest card of `command` when the pill was pressed; the run is the next one. */
  previousId: string | null;
}

export const CommitWipPill = memo(function CommitWipPill({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): ReactElement | null {
  const toast = useToast();
  const run = useRunChatCommand({ serverId, workspaceId, agentId, toast });
  const git = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    isDirty: workspace.gitRuntime?.isDirty ?? null,
    aheadOfOrigin: workspace.gitRuntime?.aheadOfOrigin ?? null,
  }));
  const isDirty = git?.isDirty ?? null;
  const [step, setStep] = useState<CommitWipStep>(() =>
    initialCommitWipStep({ isDirty, aheadOfOrigin: git?.aheadOfOrigin ?? null }),
  );
  const [pending, setPending] = useState<PendingRun | null>(null);
  // Reads the stream only while a run is pending; otherwise the selector returns at once.
  const outcome = useSessionStore((state) => {
    if (!pending) return null;
    const session = state.sessions[serverId];
    return shellCommandOutcome(
      findLatestShellCommandRun(
        [session?.agentStreamHead.get(agentId), session?.agentStreamTail.get(agentId)],
        pending.command,
      ),
      pending.previousId,
    );
  });

  useEffect(() => {
    if (!outcome || outcome === "running") return;
    setStep((current) => stepAfterRun(current, outcome));
    setPending(null);
  }, [outcome]);

  // Git push holds until the checkout changes again. The descriptor can still say dirty right after
  // the commit, so it has to read clean once before a dirty reading counts as a new change.
  const sawCleanRef = useRef(false);
  useEffect(() => {
    if (step !== "push") {
      sawCleanRef.current = false;
      return;
    }
    if (isDirty === false) sawCleanRef.current = true;
    else if (isDirty === true && sawCleanRef.current) setStep("commit");
  }, [isDirty, step]);

  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const command = COMMIT_WIP_STEP_COMMAND[step];
  const handlePress = useCallback(() => {
    if (!run) {
      toast.error(`${STEP_LABEL[step]} needs the shell-command plugin on this host`);
      return;
    }
    const session = useSessionStore.getState().sessions[serverId];
    const previous = findLatestShellCommandRun(
      [session?.agentStreamHead.get(agentId), session?.agentStreamTail.get(agentId)],
      command,
    );
    setPending({ command, previousId: previous?.id ?? null });
    run(command, { onError: () => setPending(null) });
  }, [agentId, command, run, serverId, step, toast]);
  const isRunning = pending !== null;
  const accessibilityState = useMemo(() => ({ disabled: isRunning, busy: isRunning }), [isRunning]);
  const bodyStyle = useMemo(
    () => [
      composerPillStyles.body,
      isHovered && !isRunning && composerPillStyles.bodyActive,
      isRunning && styles.running,
    ],
    [isHovered, isRunning],
  );
  const labelStyle = useMemo(
    () => [composerPillStyles.label, isHovered && !isRunning && composerPillStyles.labelActive],
    [isHovered, isRunning],
  );

  return (
    <PressHighlight
      testID="composer-commit-wip-pill"
      accessibilityRole="button"
      accessibilityLabel={`Run ${command}`}
      accessibilityState={accessibilityState}
      disabled={isRunning}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <Text style={labelStyle}>{STEP_LABEL[step]}</Text>
    </PressHighlight>
  );
});

const styles = StyleSheet.create({
  running: {
    opacity: 0.5,
  },
});
