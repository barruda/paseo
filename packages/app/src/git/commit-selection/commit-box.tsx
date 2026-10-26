// CUSTOM(commit-selection): under the Changes tree, bulk selection, discard of the checked
// files, and a message box that commits only them.
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { CommitSelection } from "./use-commit-selection";
import { isCommitMessageFocusRequested, useCommitMessageFocusStore } from "./focus-request";

function filesLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

const DEFAULT_COMMIT_MESSAGE = "wip";

function commitLabel(count: number): string {
  return count === 0 ? "Commit" : `Commit ${filesLabel(count)}`;
}

// With no uncommitted changes left, the same button pushes the commits ahead of origin.
export function CommitBox({
  selection,
  hasChanges,
  status,
  beforeCommit,
}: {
  selection: CommitSelection | null;
  hasChanges: boolean;
  status: CheckoutStatusPayload | null;
  /** Resolves false when the commit must wait for the user to review a refreshed list. */
  beforeCommit: () => Promise<boolean>;
}) {
  const canPush = (status?.aheadOfOrigin ?? 0) > 0;
  if (!selection || (!hasChanges && !canPush)) return null;
  return (
    <CommitBoxContent selection={selection} hasChanges={hasChanges} beforeCommit={beforeCommit} />
  );
}

function CommitBoxContent({
  selection,
  hasChanges,
  beforeCommit,
}: {
  selection: CommitSelection;
  hasChanges: boolean;
  beforeCommit: () => Promise<boolean>;
}) {
  const { serverId, cwd, selectedPaths, filePaths, pathspecs, selectAll, selectNone } = selection;
  const toast = useToast();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [message, setMessage] = useState("");
  const focusRequestedAt = useCommitMessageFocusStore((state) => state.requestedAt);
  useEffect(() => {
    if (isCommitMessageFocusRequested(focusRequestedAt)) inputRef.current?.focus();
  }, [focusRequestedAt]);
  const commit = useCheckoutGitActionsStore((state) => state.commit);
  const push = useCheckoutGitActionsStore((state) => state.push);
  const discardChanges = useCheckoutGitActionsStore((state) => state.discardChanges);
  const isCommitting =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "commit" }),
    ) === "pending";
  const isPushing =
    useCheckoutGitActionsStore((state) => state.getStatus({ serverId, cwd, actionId: "push" })) ===
    "pending";
  const isDiscarding =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "discard-changes" }),
    ) === "pending";
  const count = selectedPaths.length;
  // An empty message commits as "wip".
  const commitMessage = message.trim() || DEFAULT_COMMIT_MESSAGE;

  const handleCommit = useCallback(async () => {
    if (isCommitting) return;
    try {
      if (!(await beforeCommit())) return;
      if (count === 0) {
        const confirmed = await confirmDialog({
          title: "Nothing is selected, do you want to select all?",
          message: "Select all changed files to commit them.",
          confirmLabel: "Select All",
          cancelLabel: "Cancel",
        });
        if (!confirmed) return;
        selectAll();
      }
      // The selection state may not have re-rendered yet after Select All, so pass the paths.
      const paths = count === 0 ? pathspecs(filePaths) : pathspecs();
      await commit({ serverId, cwd, message: commitMessage, paths });
      inputRef.current?.reset();
      setMessage("");
      selectNone();
      // Back to the message, so the next Ctrl+Enter pushes.
      useCommitMessageFocusStore.getState().request();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Commit failed");
    }
  }, [
    beforeCommit,
    commit,
    commitMessage,
    count,
    cwd,
    filePaths,
    isCommitting,
    pathspecs,
    selectAll,
    selectNone,
    serverId,
    toast,
  ]);

  const handlePush = useCallback(async () => {
    try {
      await push({ serverId, cwd });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Push failed");
    }
  }, [cwd, push, serverId, toast]);

  const pressPrimary = useCallback(
    () => void (hasChanges ? handleCommit() : handlePush()),
    [handleCommit, handlePush, hasChanges],
  );
  // Ctrl/⌘+Enter acts on the primary button; the newline it would type is suppressed.
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const native = event.nativeEvent as TextInputKeyPressEventData & {
        ctrlKey?: boolean;
        metaKey?: boolean;
      };
      if (native.key !== "Enter" || !(native.ctrlKey || native.metaKey)) return;
      event.preventDefault();
      pressPrimary();
    },
    [pressPrimary],
  );

  const handleDiscard = useCallback(async () => {
    if (count === 0) return;
    const confirmed = await confirmDialog({
      title: `Discard changes in ${filesLabel(count)}?`,
      message:
        "Their uncommitted changes are lost, and new files are deleted. This can't be undone.",
      confirmLabel: "Discard",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await discardChanges({ serverId, cwd, paths: pathspecs() });
      selectNone();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Discard failed");
    }
  }, [count, cwd, discardChanges, pathspecs, selectNone, serverId, toast]);
  const pressDiscard = useCallback(() => void handleDiscard(), [handleDiscard]);
  const primaryLabel = hasChanges ? commitLabel(count) : "Push";

  return (
    <View style={styles.box} testID="commit-box">
      {hasChanges ? (
        <View style={styles.actions}>
          <Button
            variant="ghost"
            size="xs"
            onPress={selectAll}
            disabled={count === filePaths.length}
            testID="commit-select-all"
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onPress={selectNone}
            disabled={count === 0}
            testID="commit-select-none"
          >
            Select none
          </Button>
          <View style={styles.spacer} />
          <Button
            variant="ghost"
            size="xs"
            leftIcon={Trash2}
            onPress={pressDiscard}
            disabled={count === 0}
            loading={isDiscarding}
            testID="commit-discard-selected"
          >
            Discard selected
          </Button>
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        accessibilityLabel="Commit message"
        testID="commit-message-input"
        placeholder={
          hasChanges ? "Commit message (empty commits as wip, Ctrl+Enter)" : "Ctrl+Enter to push"
        }
        placeholderTextColor={styles.placeholder.color}
        multiline
        initialValue=""
        onChangeText={setMessage}
        onKeyPress={handleKeyPress}
        style={styles.input}
      />
      <Button
        variant="default"
        size="sm"
        onPress={pressPrimary}
        disabled={hasChanges ? isCommitting : isPushing}
        loading={hasChanges ? isCommitting : isPushing}
        testID={hasChanges ? "commit-selected" : "push-branch"}
      >
        {primaryLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  spacer: {
    flex: 1,
  },
  input: {
    minHeight: 64,
    maxHeight: 160,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlignVertical: "top",
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
}));
