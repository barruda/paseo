// CUSTOM(commit-selection): the tri-state box on Changes tree rows.
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, Minus } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import type { CommitCheckState } from "./model";

const ThemedCheck = withUnistyles(Check);
const ThemedMinus = withUnistyles(Minus);
const markColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const HIT_SLOP = 6;

export function CommitCheckbox({
  state,
  path,
  onToggle,
  testID,
}: {
  state: CommitCheckState;
  path: string;
  onToggle: (path: string) => void;
  testID?: string;
}) {
  const handlePress = useCallback(() => onToggle(path), [onToggle, path]);
  const checked = state !== "unchecked";
  return (
    <Pressable
      onPress={handlePress}
      hitSlop={HIT_SLOP}
      accessibilityRole="checkbox"
      accessibilityLabel={`Select ${path} for commit`}
      aria-checked={state === "mixed" ? "mixed" : checked}
      testID={testID}
      style={styles.hit}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {state === "checked" ? (
          <ThemedCheck size={11} strokeWidth={3} uniProps={markColorMapping} />
        ) : null}
        {state === "mixed" ? (
          <ThemedMinus size={11} strokeWidth={3} uniProps={markColorMapping} />
        ) : null}
      </View>
    </Pressable>
  );
}

/** A row's checkbox, or nothing when the row is not selectable. */
export function RowCommitCheckbox({
  state,
  path,
  onToggle,
  rowTestID,
}: {
  state: CommitCheckState | undefined;
  path: string;
  onToggle: ((path: string) => void) | undefined;
  rowTestID: string | undefined;
}) {
  if (!state || !onToggle) return null;
  return (
    <CommitCheckbox
      state={state}
      path={path}
      onToggle={onToggle}
      testID={rowTestID ? `${rowTestID}-commit-check` : undefined}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  hit: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
  },
  box: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
}));
