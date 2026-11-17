// CUSTOM(projects-assistant): charts of the Projects Dashboard, drawn with plain Views.
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { StyleSheet, Text, View } from "react-native";
import type { Stats } from "../../shared/assistant";
import {
  barRatio,
  dayLabel,
  daySegments,
  maxDayTotal,
} from "./dashboard-format";
import { dashboardStrings as s } from "./dashboard-strings";

type Theme = PluginSurfaceProps["theme"];

export const chartColors = (theme: Theme) => ({
  merged: theme.colors.statusSuccess,
  otherDone: theme.colors.accent,
  failed: theme.colors.statusDanger,
  needsYou: theme.colors.statusWarning,
});

function Legend({
  items,
}: {
  items: { label: string; color: string; theme: Theme }[];
}) {
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: item.color }]} />
          <Text
            style={{ color: item.theme.colors.foregroundMuted, fontSize: 12 }}
          >
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const BAR_AREA = 110;

export function DayChart({ stats, theme }: { stats: Stats; theme: Theme }) {
  const colors = chartColors(theme);
  const days = stats.perDay.map(daySegments);
  const max = maxDayTotal(days);
  const everyOther = days.length > 14 ? Math.ceil(days.length / 10) : 1;
  return (
    <View>
      <Legend
        items={[
          { label: s.legendMerged, color: colors.merged, theme },
          { label: s.legendOtherDone, color: colors.otherDone, theme },
          { label: s.legendFailed, color: colors.failed, theme },
          { label: s.legendNeedsYou, color: colors.needsYou, theme },
        ]}
      />
      {max === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>{s.noData}</Text>
      ) : (
        <View style={[styles.dayRow, { borderColor: theme.colors.border }]}>
          {days.map((day, index) => (
            <View
              key={day.date}
              style={styles.dayColumn}
              accessibilityLabel={`${day.date}: ${day.merged} merged, ${day.otherDone} done, ${day.failed} failed, ${day.needsYou} needs you`}
            >
              <View style={[styles.dayBarArea, { height: BAR_AREA }]}>
                <View style={styles.dayStack}>
                  {(
                    [
                      ["needsYou", day.needsYou],
                      ["failed", day.failed],
                      ["otherDone", day.otherDone],
                      ["merged", day.merged],
                    ] as const
                  ).map(([key, value]) =>
                    value > 0 ? (
                      <View
                        key={key}
                        style={{
                          height: Math.max(2, barRatio(value, max) * BAR_AREA),
                          backgroundColor: colors[key],
                        }}
                      />
                    ) : null,
                  )}
                </View>
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.dayLabel,
                  { color: theme.colors.foregroundMuted },
                ]}
              >
                {index % everyOther === 0 ? dayLabel(day.date) : ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

interface BarRow {
  key: string;
  name: string;
  done: number;
  merged: number;
  failed: number;
}

/** Horizontal bars: done (with its merged share) and failed, scaled to the largest row. */
export function HorizontalBars({
  rows,
  theme,
}: {
  rows: BarRow[];
  theme: Theme;
}) {
  const colors = chartColors(theme);
  const max = rows.reduce((m, row) => Math.max(m, row.done, row.failed), 0);
  if (rows.length === 0 || max === 0) {
    return (
      <Text style={{ color: theme.colors.foregroundMuted }}>{s.noData}</Text>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Legend
        items={[
          { label: s.legendDone, color: colors.otherDone, theme },
          { label: s.legendMerged, color: colors.merged, theme },
          { label: s.legendFailed, color: colors.failed, theme },
        ]}
      />
      {rows.map((row) => (
        <View key={row.key} style={{ gap: 3 }}>
          <Text
            numberOfLines={1}
            style={{ color: theme.colors.foreground, fontSize: 13 }}
          >
            {row.name}
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {`  ${row.done} / ${row.merged} / ${row.failed}`}
            </Text>
          </Text>
          <View
            style={[styles.track, { backgroundColor: theme.colors.surface2 }]}
          >
            <View
              style={[
                styles.fill,
                {
                  width: `${barRatio(row.done, max) * 100}%`,
                  backgroundColor: colors.otherDone,
                },
              ]}
            >
              <View
                style={{
                  width: `${barRatio(row.merged, row.done) * 100}%`,
                  height: "100%",
                  backgroundColor: colors.merged,
                }}
              />
            </View>
          </View>
          {row.failed > 0 ? (
            <View
              style={[styles.track, { backgroundColor: theme.colors.surface2 }]}
            >
              <View
                style={[
                  styles.fill,
                  {
                    width: `${barRatio(row.failed, max) * 100}%`,
                    backgroundColor: colors.failed,
                  },
                ]}
              />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  dayRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    borderBottomWidth: 1,
  },
  dayColumn: { flex: 1, minWidth: 0 },
  dayBarArea: { justifyContent: "flex-end" },
  dayStack: {
    flexDirection: "column",
    justifyContent: "flex-end",
    borderRadius: 2,
    overflow: "hidden",
  },
  dayLabel: { fontSize: 10, textAlign: "center", marginTop: 3, minHeight: 13 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4, overflow: "hidden" },
});
