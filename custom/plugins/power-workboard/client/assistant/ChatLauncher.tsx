// CUSTOM(projects-assistant): the Assistant tab of the Power Workboard (CUSTOM(workboard-inner-pages);
// it was a Desk chip before). It opens the real chat agent (a normal Paseo agent with board tools)
// in the Projects Assistant tab of the app's right sidebar (CUSTOM(assistant-sidebar)); the Desk
// then leaves the board, and `onOpened` hands the board its previous tab.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { assistantChatOpenRpc } from "../../shared/assistant-rpc";
import { openAssistantChat } from "./nav";

type Props = PluginSurfaceProps & { onOpened?: () => void };

const text = {
  opening: "Opening Projects Assistant…",
  retry: "Retry",
  open: "Open chat",
  fresh: "New conversation",
  unavailable: "This view cannot open chats.",
};

export function ChatLauncher(props: Props) {
  const { theme, navigation, onOpened } = props;
  const call = useRpc(assistantChatOpenRpc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // React strict/dev mode mounts twice; a ref keeps the automatic open to one call.
  const started = useRef(false);

  const open = async (fresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { agentId } = await call({ fresh });
      if (!navigation) throw new Error(text.unavailable);
      openAssistantChat(navigation, agentId);
      onOpened?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: primary ? theme.colors.accent : theme.colors.border,
          backgroundColor: primary
            ? theme.colors.accent
            : pressed
              ? theme.colors.surface2
              : "transparent",
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary
            ? theme.colors.accentForeground
            : theme.colors.foreground,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {busy ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {text.opening}
        </Text>
      ) : null}
      {error ? (
        <Text style={{ color: theme.colors.statusDanger }}>{error}</Text>
      ) : null}
      <View style={styles.row}>
        {error ? button(text.retry, () => void open(false), true) : null}
        {button(text.open, () => void open(false), !error)}
        {button(text.fresh, () => void open(true))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  row: { flexDirection: "row", gap: 8 },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
