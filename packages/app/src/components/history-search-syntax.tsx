import { useCallback, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

// CUSTOM(history-content-search): a collapsible reference for the operators History search
// understands (`packages/protocol/src/search/history-query.ts`). English only, like the other
// custom surfaces, so upstream locale changes never conflict.

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedChevronDown = withUnistyles(ChevronDown, mutedColorMapping);
const ThemedChevronRight = withUnistyles(ChevronRight, mutedColorMapping);

const EXPANDED_STATE = { expanded: true };
const COLLAPSED_STATE = { expanded: false };

const SYNTAX_ROWS: { example: string; meaning: string }[] = [
  { example: "relay socket", meaning: "Both words, each as the start of a word" },
  { example: '"at once"', meaning: "The exact words, next to each other and in order" },
  { example: "relay OR tunnel", meaning: "Either word (also |)" },
  { example: '-staging  -"dry run"', meaning: "Leave out sessions that mention it anywhere" },
];

/** `isVisible` follows the search field, which hides when a host predates search. */
export function HistorySearchSyntax({ isVisible }: { isVisible: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggle = useCallback(() => setIsExpanded((value) => !value), []);
  const triggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      (Boolean(hovered) || pressed) && styles.triggerActive,
    ],
    [],
  );
  const Chevron = isExpanded ? ThemedChevronDown : ThemedChevronRight;
  if (!isVisible) return null;

  return (
    <View style={styles.container}>
      <Pressable
        style={triggerStyle}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={isExpanded ? EXPANDED_STATE : COLLAPSED_STATE}
        testID="sessions-search-syntax-toggle"
      >
        <Chevron size={12} />
        <Text style={styles.triggerText}>Search syntax</Text>
      </Pressable>
      {isExpanded ? (
        <View style={styles.panel} testID="sessions-search-syntax">
          {SYNTAX_ROWS.map((row) => (
            <View key={row.example} style={styles.row}>
              <Text style={styles.example}>{row.example}</Text>
              <Text style={styles.meaning}>{row.meaning}</Text>
            </View>
          ))}
          <Text style={styles.note}>
            Message matches need every word in one message. Lowercase “or” is a plain word.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    alignItems: "flex-start",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[2],
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[1],
    marginLeft: -theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  triggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  triggerText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  panel: {
    marginTop: theme.spacing[2],
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    maxWidth: 560,
    alignSelf: "stretch",
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[3],
  },
  example: {
    width: 170,
    flexShrink: 0,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  meaning: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
