// CUSTOM(commit-selection): under the Changes tree, bulk selection, discard of the checked
// files, and a message box that commits only them.
import { useCallback, useRef, useState } from "react";
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
import { confirmDialog } from "@/utils/confirm-dialog";
import type { CommitSelection } from "./use-commit-selection";

function filesLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function CommitBox({
  selection,
  hasChanges,
}: {
  selection: CommitSelection | null;
  hasChanges: boolean;
}) {
  if (!selection || !hasChanges) return null;
  return <CommitBoxContent selection={selection} />;
}

function CommitBoxContent({ selection }: { selection: CommitSelection }) {
  const { serverId, cwd, selectedPaths, filePaths, pathspecs, selectAll, selectNone } = selection;
  const toast = useToast();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [message, setMessage] = useState("");
  const commit = useCheckoutGitActionsStore((state) => state.commit);
  const discardChanges = useCheckoutGitActionsStore((state) => state.discardChanges);
  const isCommitting =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "commit" }),
    ) === "pending";
  const isDiscarding =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "discard-changes" }),
    ) === "pending";
  const count = selectedPaths.length;
  const trimmed = message.trim();
  const canCommit = count > 0 && trimmed.length > 0 && !isCommitting;

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    try {
      await commit({ serverId, cwd, message: trimmed, paths: pathspecs() });
      inputRef.current?.reset();
      setMessage("");
      selectNone();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Commit failed");
    }
  }, [canCommit, commit, cwd, pathspecs, selectNone, serverId, toast, trimmed]);

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
  const pressCommit = useCallback(() => void handleCommit(), [handleCommit]);
  const pressDiscard = useCallback(() => void handleDiscard(), [handleDiscard]);

  return (
    <View style={styles.box} testID="commit-box">
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
      <TextInput
        ref={inputRef}
        accessibilityLabel="Commit message"
        testID="commit-message-input"
        placeholder="Commit message"
        placeholderTextColor={styles.placeholder.color}
        multiline
        initialValue=""
        onChangeText={setMessage}
        style={styles.input}
      />
      <Button
        variant="default"
        size="sm"
        onPress={pressCommit}
        disabled={!canCommit}
        loading={isCommitting}
        testID="commit-selected"
      >
        {count === 0 ? "Commit" : `Commit ${filesLabel(count)}`}
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
