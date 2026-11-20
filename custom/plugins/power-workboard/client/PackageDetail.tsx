// CUSTOM(packages): one package's tickets, merge order, gate configuration and run history.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { packageTaskOrder, effectiveTestTier } from "../shared/packages";
import type { Board, PackageRun, PackageView } from "../shared/model";
import { groupColorValue } from "./colors";
import type { strings } from "./strings";

export function PackageDetail({
  pkg,
  board,
  runs,
  t,
  theme,
  onClose,
  onRunGate,
  onAdjust,
  onClosePackage,
}: {
  pkg: PackageView;
  board: Board;
  runs: readonly PackageRun[];
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onRunGate(): void;
  onAdjust(): void;
  onClosePackage(): void;
}) {
  const tasks = packageTaskOrder(board.cards, board.finishes, pkg.id);
  return (
    <Modal
      open
      title={`${t.packages.detailTitle}: ${pkg.name}`}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content scrollable={false}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View
              style={[
                styles.dot,
                { backgroundColor: groupColorValue(pkg.color, theme) },
              ]}
            />
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {pkg.projectName} ·{" "}
              {t.packages.progress
                .replace("{merged}", String(pkg.merged))
                .replace("{total}", String(pkg.total))}
            </Text>
          </View>
          <View style={styles.actions}>
            <Action
              icon="Play"
              label={t.packages.runGate}
              theme={theme}
              onPress={onRunGate}
            />
            <Action
              icon="Settings2"
              label={t.packages.adjust}
              theme={theme}
              onPress={onAdjust}
            />
            {pkg.status === "open" && (
              <Action
                icon="Archive"
                label={t.packages.closePackage}
                theme={theme}
                onPress={onClosePackage}
              />
            )}
          </View>
          <View style={[styles.config, { borderColor: theme.colors.border }]}>
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              Gate: {pkg.gate.command || t.packages.gateNotConfigured}
            </Text>
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {pkg.gate.requiredEnv.length
                ? `Env: ${pkg.gate.requiredEnv.join(", ")}`
                : "Env: none"}
            </Text>
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              Trigger: {pkg.trigger.night ? t.packages.triggerNight : ""}
              {pkg.trigger.night && pkg.trigger.onClose ? " · " : ""}
              {pkg.trigger.onClose ? t.packages.triggerClose : ""}
              {pkg.trigger.everyMerges
                ? ` · ${t.packages.everyMerges} ${pkg.trigger.everyMerges}`
                : ""}
            </Text>
            {pkg.branch ? (
              <Text
                style={[styles.meta, { color: theme.colors.foregroundMuted }]}
              >
                Branch: {pkg.branch}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.section, { color: theme.colors.foreground }]}>
            {t.packages.tickets} · {t.packages.mergeOrder}
          </Text>
          {tasks.map((task) => {
            const finish = board.finishes[task.id];
            const tier = effectiveTestTier(task);
            return (
              <View
                key={task.id}
                style={[styles.row, { borderColor: theme.colors.border }]}
              >
                <Text
                  style={[
                    styles.number,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  #{task.number}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.title, { color: theme.colors.foreground }]}
                >
                  {task.title}
                </Text>
                <Text
                  style={[styles.meta, { color: theme.colors.foregroundMuted }]}
                >
                  {finish?.mergedAt
                    ? new Date(finish.mergedAt).toLocaleString(t.locale)
                    : t.packages.notMerged}
                </Text>
                <Text
                  style={[
                    styles.chip,
                    {
                      borderColor: theme.colors.border,
                      color: theme.colors.foregroundMuted,
                    },
                  ]}
                >
                  {t.packages.tier[tier]}
                </Text>
              </View>
            );
          })}
          <Text style={[styles.section, { color: theme.colors.foreground }]}>
            {t.packages.runs}
          </Text>
          {!runs.length && (
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {t.packages.noRuns}
            </Text>
          )}
          {runs.map((run) => (
            <View
              key={run.id}
              style={[styles.run, { borderColor: theme.colors.border }]}
            >
              <View style={styles.runHeader}>
                <Text
                  style={{
                    color:
                      run.status === "passed"
                        ? theme.colors.statusSuccess
                        : run.status === "running"
                          ? theme.colors.foregroundMuted
                          : theme.colors.statusDanger,
                  }}
                >
                  {run.status}
                </Text>
                <Text
                  style={[styles.meta, { color: theme.colors.foregroundMuted }]}
                >
                  {run.trigger} ·{" "}
                  {new Date(run.startedAt).toLocaleString(t.locale)}
                  {run.durationMs === null
                    ? ""
                    : ` · ${Math.round(run.durationMs / 1000)}s`}
                </Text>
                {run.suspectTaskId && (
                  <Text
                    style={[styles.meta, { color: theme.colors.statusDanger }]}
                  >
                    {t.packages.suspect}: {run.suspectTaskId.slice(0, 8)}
                  </Text>
                )}
              </View>
              {run.output ? (
                <Text
                  numberOfLines={6}
                  style={[
                    styles.output,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  {run.output}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}

function Action({
  icon,
  label,
  theme,
  onPress,
}: {
  icon: string;
  label: string;
  theme: PluginSurfaceProps["theme"];
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderColor: theme.colors.border },
        pressed && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <Icon name={icon} size={15} color={theme.colors.foreground} />
      <Text style={{ color: theme.colors.foreground }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  config: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  section: { fontWeight: "600", marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexWrap: "wrap",
  },
  number: { fontSize: 12, minWidth: 34 },
  title: { flex: 1, minWidth: 140 },
  meta: { fontSize: 12 },
  chip: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  run: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  runHeader: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  output: { fontSize: 11, fontFamily: "monospace" },
});
