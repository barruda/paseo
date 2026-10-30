import { useSettings, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Loading, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TLDR_PROMPT, tldrSettings } from "../shared/tldr";

function themedStyles(theme: PluginTheme) {
  return StyleSheet.create({
    hint: { fontSize: 13, color: theme.colors.foregroundMuted },
    error: { fontSize: 13, color: theme.colors.statusDanger },
    input: {
      minHeight: 120,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      fontSize: 14,
      textAlignVertical: "top",
      color: theme.colors.foreground,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface0,
    },
    actions: { flexDirection: "row", alignItems: "center", gap: 8 },
    spacer: { flex: 1 },
    button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
    save: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
      backgroundColor: theme.colors.accent,
    },
    saveDisabled: { opacity: 0.5 },
    label: { fontSize: 14, fontWeight: "500", color: theme.colors.foregroundMuted },
    saveLabel: { fontSize: 14, fontWeight: "500", color: theme.colors.accentForeground },
  });
}

/** Edits the message the TLDR pill and `/tldr` send. Saved on the daemon, so it survives restarts. */
export function TldrPromptModal({ theme, close }: PluginButtonContentProps) {
  const settings = useSettings(tldrSettings);
  const styles = useMemo(() => themedStyles(theme), [theme]);
  const [draft, setDraft] = useState<string | null>(null);
  const ready = settings.status === "ready";
  const text = draft ?? (settings.status === "ready" ? settings.values.prompt : "");
  const error =
    settings.status === "error" || settings.status === "invalid"
      ? settings.error
      : settings.saveError;
  const canSave = ready && !settings.saving && text.trim().length > 0;
  const revision = settings.status === "ready" ? settings.revision : null;
  const { save } = settings;

  const submit = useCallback(async () => {
    if (revision === null) return;
    if (await save({ prompt: text }, revision)) close();
  }, [close, revision, save, text]);
  const useDefault = useCallback(() => setDraft(TLDR_PROMPT), []);
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close],
  );
  const saveStyle = useMemo(
    () => (canSave ? styles.save : [styles.save, styles.saveDisabled]),
    [canSave, styles],
  );

  return (
    <Modal open title="TLDR message" onOpenChange={onOpenChange}>
      <Modal.Content>
        <Text style={styles.hint}>The TLDR button and /tldr send this message to the agent.</Text>
        {settings.status === "loading" ? (
          <Loading />
        ) : (
          <TextInput
            value={text}
            onChangeText={setDraft}
            multiline
            autoFocus
            placeholder={TLDR_PROMPT}
            placeholderTextColor={theme.colors.foregroundMuted}
            editable={ready && !settings.saving}
            style={styles.input}
            testID="tldr-prompt-input"
          />
        )}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={!ready || settings.saving}
            onPress={useDefault}
            style={styles.button}
          >
            <Text style={styles.label}>Use default</Text>
          </Pressable>
          <View style={styles.spacer} />
          <Pressable accessibilityRole="button" onPress={close} style={styles.button}>
            <Text style={styles.label}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canSave}
            onPress={submit}
            style={saveStyle}
            testID="tldr-prompt-save"
          >
            <Text style={styles.saveLabel}>Save</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
