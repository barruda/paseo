// CUSTOM(factory): the factory's line (docs/factory.md, tickets 7 and 9). Shadow mode shows the
// difference count; active mode shows the loaded revision (the count compares against the ignored
// JSON, so it is not shown). Both show the factory's errors while it is invalid. The board shows it
// under the toolbar and the Orchestrators tab under its intro. Nothing renders while the mode is off.
import { StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { FactorySummary } from "../shared/factory/status";
import type { strings } from "./strings";

type Strings = ReturnType<typeof strings>["factory"];

/** Active mode: the factory is the board's configuration and its fields are read only. */
export function factoryOwnsConfig(
  summary: FactorySummary | null | undefined,
): boolean {
  return summary?.mode === "active";
}

export function factoryLines(
  summary: FactorySummary | null | undefined,
  t: Strings,
): { status: string; error: string | null; note: string | null } | null {
  if (!summary) return null;
  const status =
    summary.differences !== null
      ? summary.mode === "active"
        ? summary.revision
          ? t.active.replace("{revision}", summary.revision.slice(0, 7))
          : t.activeNoRevision
        : t.differences.replace("{count}", String(summary.differences))
      : summary.loading
        ? t.loading
        : t.invalid;
  return {
    status: status.replace("{mode}", summary.mode),
    error: summary.errors
      ? t.errors
          .replace("{count}", String(summary.errors))
          .replace("{first}", summary.firstError ?? "")
      : null,
    note: summary.note,
  };
}

export function FactoryLine(props: {
  summary: FactorySummary | null | undefined;
  t: Strings;
  theme: PluginSurfaceProps["theme"];
  inset?: boolean;
}) {
  const lines = factoryLines(props.summary, props.t);
  if (!lines) return null;
  const { colors } = props.theme;
  return (
    <View
      testID="workboard-factory-line"
      style={[styles.box, props.inset && styles.inset]}
    >
      <Text style={[styles.text, { color: colors.foregroundMuted }]}>
        {lines.status}
      </Text>
      {lines.error && (
        <Text style={[styles.text, { color: colors.statusDanger }]}>
          {lines.error}
        </Text>
      )}
      {lines.note && (
        <Text style={[styles.text, { color: colors.statusWarning }]}>
          {lines.note}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 2 },
  inset: { paddingHorizontal: 16, paddingTop: 8 },
  text: { fontSize: 12, lineHeight: 16 },
});
