import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Check, Play } from "lucide-react-native";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import { useChatCodeRun } from "./context";
import { resolveRunnableCommand } from "./model";

// CUSTOM(chat-code-run): Run button that sits left of a code block's top Copy button and sends
// the block's command to the shell-command plugin, as if `!<command>` was typed in the composer.

const RAN_RESET_MS = 1500;
const ICON_SIZE = 14;

export const CodeBlockRunButton = React.memo(function CodeBlockRunButton({
  code,
  language,
  visible,
}: {
  code: string;
  language: string | null | undefined;
  visible: boolean;
}) {
  const run = useChatCodeRun();
  const command = useMemo(() => resolveRunnableCommand(code, language), [code, language]);
  const [ran, setRan] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handlePress = useCallback(() => {
    if (!run || !command) return;
    run(command);
    setRan(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setRan(false);
      resetRef.current = null;
    }, RAN_RESET_MS);
  }, [command, run]);

  const wrapperStyle = useMemo(
    () => [styles.container, visible ? styles.containerVisible : styles.containerHidden],
    [visible],
  );

  if (!run || !command) return null;

  return (
    <Pressable
      onPress={handlePress}
      style={wrapperStyle}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityRole="button"
      accessibilityLabel="Run command"
      hitSlop={8}
      dataSet={markdownCopyDataSet.ignore}
      testID="code-block-run-button"
    >
      {({ hovered }) => {
        const iconColor = hovered ? styles.iconHoveredColor.color : styles.iconColor.color;
        return ran ? (
          <Check size={ICON_SIZE} color={iconColor} />
        ) : (
          <Play size={ICON_SIZE} color={iconColor} />
        );
      }}
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: theme.spacing[2],
    // Copy sits at `right: spacing[2]` and is ICON_SIZE + 2 * spacing[1] wide; leave spacing[1].
    right: theme.spacing[2] + ICON_SIZE + theme.spacing[1] * 3,
    padding: theme.spacing[1],
  },
  containerVisible: {
    opacity: 1,
  },
  containerHidden: {
    opacity: 0,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));
