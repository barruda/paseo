// CUSTOM(pm-restart-button): the "Reiniciar paseo daemons" button next to a `seu` that asks the
// user to restart the Paseo daemons. It runs the same RPC as the Workboard's "Build and redeploy
// Paseo" button (redeployPaseoRpc), after the same confirmation, and shows the script's output.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { redeployPaseoRpc } from "../../shared/rpc";
import { ConfirmationModal } from "../ConfirmationModal";
import { strings } from "../strings";
import { usePaseoLocale } from "../paseo-language";
import type { CardLabels } from "./reports-strings";

export function RestartDaemonsButton({
  theme,
  labels,
}: {
  theme: PluginTimelineItemProps["theme"];
  labels: CardLabels;
}) {
  const locale = usePaseoLocale();
  const t = strings(locale === "pt" ? "en" : locale);
  const callRedeploy = useRpc(redeployPaseoRpc);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(
    null,
  );
  const c = theme.colors;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.restartDaemons}
        onPress={() => setConfirming(true)}
        style={({ pressed }) => [
          styles.button,
          { borderColor: c.statusWarning, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Icon name="RefreshCw" size={14} color={c.statusWarning} />
        <Text style={[styles.text, { color: c.statusWarning }]}>
          {labels.restartDaemons}
        </Text>
      </Pressable>
      {result ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.output,
            { color: result.ok ? c.foregroundMuted : c.statusWarning },
          ]}
        >
          {result.output}
        </Text>
      ) : null}
      {confirming ? (
        <ConfirmationModal
          title={labels.restartDaemons}
          description={labels.restartDaemonsConfirm}
          confirmLabel={labels.restartDaemons}
          disabled={false}
          t={t}
          theme={theme}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              setResult(await callRedeploy({}));
            } catch {
              setResult({ ok: false, output: labels.restartDaemonsFailed });
            }
            return true;
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginLeft: "auto",
    alignItems: "flex-end",
    gap: 4,
    maxWidth: "100%",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  text: { fontSize: 13, lineHeight: 20, fontWeight: "600" },
  output: { fontSize: 12, lineHeight: 18 },
});
