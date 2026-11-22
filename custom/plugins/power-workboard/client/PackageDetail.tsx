// CUSTOM(packages): one package's tickets, merge order, gate configuration and run history.
// A large modal with three sub-tabs (Summary, Tickets, Gate history); the actions are grouped
// by role, colored by intent and explained by a hint on hover, focus or long press.
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import {
  packageTaskOrder,
  effectiveTestTier,
  gateRunForMerge,
} from "../shared/packages";
import type {
  Board,
  PackageRun,
  PackageRunStatus,
  PackageView,
} from "../shared/model";
import { groupColorValue } from "./colors";
import { HintButton, HintProvider } from "./Hint";
import { gateLabel } from "./PackagesView";
import type { strings } from "./strings";

type Theme = PluginSurfaceProps["theme"];
type Strings = ReturnType<typeof strings>;

export const PACKAGE_DETAIL_TABS = ["summary", "tickets", "gate"] as const;
export type PackageDetailTab = (typeof PACKAGE_DETAIL_TABS)[number];
/** Action colors by intent. Every color is a theme token. */
export type ActionIntent = "primary" | "neutral" | "info" | "danger";

// CUSTOM(plugin-modal-size): 80% of the window on desktop; phones keep the full sheet.
const LARGE_MODAL = { size: "large" } as object;

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
  onProposeClose,
}: {
  pkg: PackageView;
  board: Board;
  runs: readonly PackageRun[];
  t: Strings;
  theme: Theme;
  onClose(): void;
  onRunGate(): void;
  onAdjust(): void;
  onClosePackage(): void;
  onProposeClose(): void;
}) {
  // Local state: the modal stays mounted while the board refreshes, so the tab survives.
  const [tab, setTab] = useState<PackageDetailTab>("summary");
  const tasks = packageTaskOrder(board.cards, board.finishes, pkg.id);
  const counts: Record<PackageDetailTab, number | null> = {
    summary: null,
    tickets: tasks.length,
    gate: runs.length,
  };
  return (
    <Modal
      open
      title={`${t.packages.detailTitle}: ${pkg.name}`}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content
        {...LARGE_MODAL}
        scrollable={false}
        contentContainerStyle={styles.body}
      >
        <HintProvider theme={theme}>
          <View style={styles.stack}>
            <View style={styles.header}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: groupColorValue(pkg.color, theme) },
                ]}
              />
              <Text
                numberOfLines={1}
                style={[styles.meta, { color: theme.colors.foregroundMuted }]}
              >
                {pkg.projectName}
              </Text>
            </View>
            <View
              accessibilityRole="tablist"
              style={[styles.tabs, { borderColor: theme.colors.border }]}
            >
              {PACKAGE_DETAIL_TABS.map((id) => {
                const selected = id === tab;
                const count = counts[id];
                return (
                  <Pressable
                    key={id}
                    testID={`package-tab-${id}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setTab(id)}
                    style={[
                      styles.tab,
                      {
                        borderColor: selected
                          ? theme.colors.accent
                          : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: selected
                          ? theme.colors.foreground
                          : theme.colors.foregroundMuted,
                        fontWeight: selected ? "600" : "400",
                      }}
                    >
                      {t.packages.tabs[id]}
                      {count === null ? "" : ` (${count})`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
            >
              {tab === "summary" && (
                <Summary
                  pkg={pkg}
                  t={t}
                  theme={theme}
                  onRunGate={onRunGate}
                  onAdjust={onAdjust}
                  onClosePackage={onClosePackage}
                  onProposeClose={onProposeClose}
                />
              )}
              {tab === "tickets" && (
                <Tickets
                  tasks={tasks}
                  board={board}
                  runs={runs}
                  t={t}
                  theme={theme}
                />
              )}
              {tab === "gate" && (
                <Runs runs={runs} board={board} t={t} theme={theme} />
              )}
            </ScrollView>
          </View>
        </HintProvider>
      </Modal.Content>
    </Modal>
  );
}

function Summary({
  pkg,
  t,
  theme,
  onRunGate,
  onAdjust,
  onClosePackage,
  onProposeClose,
}: {
  pkg: PackageView;
  t: Strings;
  theme: Theme;
  onRunGate(): void;
  onAdjust(): void;
  onClosePackage(): void;
  onProposeClose(): void;
}) {
  const open = pkg.status === "open";
  const triggers = [
    pkg.trigger.night ? t.packages.triggerNight : null,
    pkg.trigger.onClose ? t.packages.triggerClose : null,
    pkg.trigger.everyMerges
      ? `${t.packages.everyMerges} ${pkg.trigger.everyMerges}`
      : null,
  ].filter((value): value is string => !!value);
  const lastRun = pkg.lastRun;
  return (
    <>
      <View style={styles.chips}>
        <Chip
          label={open ? t.packages.statusOpen : t.packages.statusClosed}
          color={
            open ? theme.colors.statusSuccess : theme.colors.foregroundMuted
          }
          theme={theme}
        />
        <Chip
          label={t.packages.progress
            .replace("{merged}", String(pkg.merged))
            .replace("{total}", String(pkg.total))}
          color={theme.colors.foregroundMuted}
          theme={theme}
        />
        <Chip
          label={`${t.packages.lastGate}: ${gateLabel(pkg, t)}`}
          color={runStatusColor(lastRun?.status ?? null, theme)}
          theme={theme}
        />
        {lastRun ? (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {new Date(lastRun.startedAt).toLocaleString(t.locale)}
          </Text>
        ) : null}
      </View>
      <Section title={t.packages.gateConfig} theme={theme}>
        <Field
          label={t.packages.gateCommand}
          value={pkg.gate.command || t.packages.gateNotConfigured}
          mono={!!pkg.gate.command}
          theme={theme}
        />
        <Field
          label={t.packages.env}
          value={
            pkg.gate.requiredEnv.length
              ? pkg.gate.requiredEnv.join(", ")
              : t.packages.envNone
          }
          theme={theme}
        />
        <Field
          label={t.packages.trigger}
          value={
            triggers.length ? triggers.join(" · ") : t.packages.triggerNone
          }
          theme={theme}
        />
        {pkg.branch ? (
          <Field
            label={t.packages.branch}
            value={pkg.branch}
            mono
            theme={theme}
          />
        ) : null}
      </Section>
      <Section title={t.packages.groupGate} theme={theme}>
        <View style={styles.actions}>
          <Action
            id="run-gate"
            icon="Play"
            label={t.packages.runGate}
            hint={t.packages.hints.runGate}
            intent="primary"
            theme={theme}
            onPress={onRunGate}
          />
          <Action
            id="adjust"
            icon="Settings2"
            label={t.packages.adjust}
            hint={t.packages.hints.adjust}
            intent="neutral"
            theme={theme}
            onPress={onAdjust}
          />
        </View>
      </Section>
      {open && (
        <Section title={t.packages.groupClose} theme={theme}>
          <View style={styles.actions}>
            <Action
              id="propose-close"
              icon="Send"
              label={t.packages.proposeClose}
              hint={t.packages.hints.proposeClose}
              intent="info"
              theme={theme}
              onPress={onProposeClose}
            />
            <View style={styles.spacer} />
            <Action
              id="close-package"
              icon="Archive"
              label={t.packages.closePackage}
              hint={t.packages.hints.closePackage}
              intent="danger"
              theme={theme}
              onPress={onClosePackage}
            />
          </View>
        </Section>
      )}
    </>
  );
}

function Tickets({
  tasks,
  board,
  runs,
  t,
  theme,
}: {
  tasks: Board["cards"];
  board: Board;
  runs: readonly PackageRun[];
  t: Strings;
  theme: Theme;
}) {
  if (!tasks.length)
    return (
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {t.packages.noTickets}
      </Text>
    );
  return (
    <>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {t.packages.mergeOrder}
      </Text>
      {tasks.map((task) => {
        const finish = board.finishes[task.id];
        const tier = effectiveTestTier(task);
        // CUSTOM(packages): the gate run that covered this merge, if one ran after it.
        const gateRun = gateRunForMerge(finish?.mergedAt ?? null, runs);
        return (
          <View
            key={task.id}
            style={[styles.row, { borderColor: theme.colors.border }]}
          >
            <Text
              style={[styles.number, { color: theme.colors.foregroundMuted }]}
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
            <Chip
              label={t.packages.tier[tier]}
              color={theme.colors.foregroundMuted}
              theme={theme}
            />
            {finish?.mergedAt ? (
              <Text
                style={[styles.meta, { color: theme.colors.foregroundMuted }]}
              >
                {t.packages.gateAfterMerge}:{" "}
                <Text
                  style={{
                    color: runStatusColor(gateRun?.status ?? null, theme),
                  }}
                >
                  {gateRun ? gateRun.status : t.packages.gatePending}
                </Text>
              </Text>
            ) : null}
            {finish?.mergeTarget ? (
              <Text
                style={[styles.meta, { color: theme.colors.foregroundMuted }]}
              >
                {t.packages.mergeTarget}: {finish.mergeTarget}
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function Runs({
  runs,
  board,
  t,
  theme,
}: {
  runs: readonly PackageRun[];
  board: Board;
  t: Strings;
  theme: Theme;
}) {
  if (!runs.length)
    return (
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {t.packages.noRuns}
      </Text>
    );
  return (
    <>
      {runs.map((run) => {
        const suspect = run.suspectTaskId
          ? board.cards.find((card) => card.id === run.suspectTaskId)
          : undefined;
        return (
          <View
            key={run.id}
            style={[styles.run, { borderColor: theme.colors.border }]}
          >
            <View style={styles.runHeader}>
              <Text
                style={{
                  color: runStatusColor(run.status, theme),
                  fontWeight: "600",
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
                  {t.packages.suspect}:{" "}
                  {suspect
                    ? `#${suspect.number} ${suspect.title}`
                    : run.suspectTaskId.slice(0, 8)}
                </Text>
              )}
            </View>
            {run.output ? (
              <Text
                numberOfLines={8}
                style={[styles.output, { color: theme.colors.foregroundMuted }]}
              >
                {run.output}
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: Theme;
  children: ReactNode;
}) {
  return (
    <View style={[styles.section, { borderColor: theme.colors.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  mono = false,
  theme,
}: {
  label: string;
  value: string;
  mono?: boolean;
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      <Text
        style={[styles.fieldLabel, { color: theme.colors.foregroundMuted }]}
      >
        {label}
      </Text>
      <Text
        selectable
        style={[
          styles.fieldValue,
          mono && styles.mono,
          { color: theme.colors.foreground },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function Chip({
  label,
  color,
  theme,
}: {
  label: string;
  color: string;
  theme: Theme;
}) {
  return (
    <Text style={[styles.chip, { borderColor: theme.colors.border, color }]}>
      {label}
    </Text>
  );
}

/** Colors for an action of each intent, from theme tokens only. */
export function actionColors(
  intent: ActionIntent,
  theme: Theme,
): { background: string; border: string; foreground: string } {
  const { colors } = theme;
  if (intent === "primary")
    return {
      background: colors.accent,
      border: colors.accent,
      foreground: colors.accentForeground,
    };
  if (intent === "info")
    return {
      background: "transparent",
      border: colors.accent,
      foreground: colors.accent,
    };
  if (intent === "danger")
    return {
      background: "transparent",
      border: colors.statusDanger,
      foreground: colors.statusDanger,
    };
  return {
    background: "transparent",
    border: colors.border,
    foreground: colors.foreground,
  };
}

function runStatusColor(status: PackageRunStatus | null, theme: Theme) {
  if (status === "passed") return theme.colors.statusSuccess;
  if (status === "missing-deps") return theme.colors.statusWarning;
  if (status === "failed" || status === "error")
    return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

function Action({
  id,
  icon,
  label,
  hint,
  intent,
  theme,
  onPress,
}: {
  id: string;
  icon: string;
  label: string;
  hint: string;
  intent: ActionIntent;
  theme: Theme;
  onPress(): void;
}) {
  const colors = actionColors(intent, theme);
  return (
    <HintButton
      testID={`package-action-${id}`}
      hint={hint}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: colors.background, borderColor: colors.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={15} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontWeight: "500" }}>
        {label}
      </Text>
    </HintButton>
  );
}

const styles = StyleSheet.create({
  // A 16px gutter on every form factor; rows wrap, so nothing scrolls sideways.
  body: { padding: 16 },
  stack: { flex: 1, minHeight: 0, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderBottomWidth: 1,
    gap: 4,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 2,
    marginBottom: -1,
  },
  scroll: { flex: 1, minHeight: 0 },
  content: { gap: 12, paddingBottom: 8 },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  section: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  sectionTitle: { fontWeight: "600" },
  field: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fieldLabel: { fontSize: 12, minWidth: 80 },
  fieldValue: { fontSize: 12, flexShrink: 1 },
  mono: { fontFamily: "monospace" },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  spacer: { flexGrow: 1 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
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
    paddingHorizontal: 8,
    paddingVertical: 2,
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
