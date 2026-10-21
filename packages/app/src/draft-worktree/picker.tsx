import { Folder, GitBranch } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useHostFeature } from "@/runtime/host-features";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { slugify } from "@getpaseo/protocol/branch-slug";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import {
  type DraftIsolation,
  type DraftWorktreeSource,
  resolveDraftBaseBranch,
  useDraftWorktreeChoice,
  useDraftWorktreeStore,
} from "./model";

// CUSTOM(draft-worktree): Local or New worktree, in the empty middle of a new session. Typing a
// name or a branch picks New worktree; a blank name lets the daemon name it from the first
// message. The worktree starts from the checkout's current branch unless "from" is edited.

const NameInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const OPTIONS: SegmentedControlOption<DraftIsolation>[] = [
  {
    value: "local",
    label: "Local",
    icon: ({ color, size }) => <Folder color={color} size={size} />,
    testID: "draft-worktree-local",
  },
  {
    value: "worktree",
    label: "New worktree",
    icon: ({ color, size }) => <GitBranch color={color} size={size} />,
    testID: "draft-worktree-worktree",
  },
];

/**
 * Tasks mode has no New workspace step, so a draft in a git project offers the worktree. Returns
 * its project and the branch its checkout is on, or null when the draft offers none.
 */
export function useDraftWorktreeSource(
  serverId: string,
  workspaceId: string | null,
  enabled: boolean,
): DraftWorktreeSource | null {
  const tasksMode = useTaskNavigationStore((state) => state.enabled);
  // COMPAT(workspaceMultiplicity): same gate as New workspace's worktree option.
  const supportsMultiplicity = useHostFeature(serverId, "workspaceMultiplicity");
  const workspace = useWorkspaceFields(serverId, workspaceId, (w) => ({
    projectId: w.projectId,
    projectKind: w.projectKind,
    currentBranch: w.gitRuntime?.currentBranch ?? null,
  }));
  return useMemo(() => {
    const offered = enabled && tasksMode && supportsMultiplicity;
    if (!offered || workspace?.projectKind !== "git" || !workspace.projectId) return null;
    return { projectId: workspace.projectId, currentBranch: workspace.currentBranch };
  }, [enabled, supportsMultiplicity, tasksMode, workspace]);
}

function describeChoice(isWorktree: boolean, name: string, baseBranch: string | null): string {
  if (!isWorktree) return "Starts in the project's checkout. Type a name for a new worktree.";
  const from = baseBranch ? `, from ${baseBranch}` : "";
  const slug = slugify(name);
  if (slug) return `Starts in a new worktree on ${slug}${from}.`;
  return `Starts in a new worktree${from}, named from your first message.`;
}

export function DraftWorktreePicker({
  draftId,
  source,
  onSubmitName,
}: {
  draftId: string;
  /** From useDraftWorktreeSource; null renders nothing. */
  source: DraftWorktreeSource | null;
  /** Enter in the name field; the draft moves focus to the composer. */
  onSubmitName?: () => void;
}): ReactElement | null {
  const choice = useDraftWorktreeChoice(draftId);
  const setIsolation = useCallback(
    (isolation: DraftIsolation) =>
      useDraftWorktreeStore.getState().setIsolation(draftId, isolation),
    [draftId],
  );
  const setName = useCallback(
    (name: string) => useDraftWorktreeStore.getState().setName(draftId, name),
    [draftId],
  );
  const setBaseBranch = useCallback(
    (baseBranch: string) => useDraftWorktreeStore.getState().setBaseBranch(draftId, baseBranch),
    [draftId],
  );
  // The field shows the checkout's branch until edited; the branch can arrive after it mounts.
  const branchInputRef = useRef<EditingTextInputHandle>(null);
  const untouchedBranch = choice.baseBranch === null ? (source?.currentBranch ?? null) : null;
  useEffect(() => {
    if (untouchedBranch) branchInputRef.current?.replaceText(untouchedBranch);
  }, [untouchedBranch]);
  const isWorktree = choice.isolation === "worktree";
  if (!source) return null;
  const baseBranch = resolveDraftBaseBranch(choice, source);

  return (
    <View style={styles.container} testID="draft-worktree-picker">
      <SegmentedControl
        size="sm"
        options={OPTIONS}
        value={choice.isolation}
        onValueChange={setIsolation}
      />
      <View style={styles.fields}>
        <View
          style={[styles.inputWrapper, styles.nameField, isWorktree && styles.inputWrapperActive]}
        >
          <NameInput
            key={draftId}
            style={styles.input}
            initialValue={choice.name}
            onChangeText={setName}
            onSubmitEditing={onSubmitName}
            placeholder="Worktree name"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Worktree name"
            testID="draft-worktree-name"
          />
        </View>
        <Text style={styles.fromLabel}>from</Text>
        <View
          style={[styles.inputWrapper, styles.branchField, isWorktree && styles.inputWrapperActive]}
        >
          <NameInput
            key={draftId}
            ref={branchInputRef}
            style={styles.input}
            initialValue={baseBranch ?? ""}
            onChangeText={setBaseBranch}
            onSubmitEditing={onSubmitName}
            placeholder="Branch"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Start the worktree from branch"
            testID="draft-worktree-base-branch"
          />
        </View>
      </View>
      <Text style={styles.hint}>{describeChoice(isWorktree, choice.name, baseBranch)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  fields: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  nameField: {
    flex: 3,
  },
  branchField: {
    flex: 2,
  },
  fromLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  inputWrapper: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  inputWrapperActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
