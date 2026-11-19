// CUSTOM(projects-assistant): the Projects Dashboard. Opens with what needs the user, then what is
// running, the numbers, charts and the history of the assistant's decisions.
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import {
  HISTORY_EVENT_KINDS,
  type AssistantActionInput,
  type HistoryEvent,
  type HistoryEventKind,
  type NeedsYouItem,
  type RunningItem,
  type Stats,
} from "../../shared/assistant";
import {
  assistantActionRpc,
  assistantHistoryRpc,
  assistantOverviewRpc,
  assistantStatsRpc,
} from "../../shared/assistant-rpc";
import { projectColor } from "../colors";
import { showConversation, showReport } from "./nav";
import { DayChart, HorizontalBars } from "./dashboard-charts";
import {
  COLLAPSED_DETAIL_LINES,
  DEFAULT_PERIOD,
  PERIODS,
  formatAge,
  formatDecimal,
  formatDuration,
  formatElapsed,
  formatPercent,
  formatTime,
  isWide,
} from "./dashboard-format";
import { formatClock, progressBadge } from "../checkpoint-format"; // CUSTOM(task-checkpoints)
import {
  KIND_LABELS,
  REASON_LABELS,
  STAGE_LABELS,
  dashboardStrings as s,
  fixHoldText, // CUSTOM(resource-pools)
  fixWaitedText, // CUSTOM(resource-pools)
} from "./dashboard-strings";
import { usePaseoLocale } from "../paseo-language"; // CUSTOM(resource-pools)

type Props = PluginSurfaceProps;
type Theme = Props["theme"];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function DashboardScreen(props: PluginSurfaceProps) {
  const { theme } = props;
  const hostId = props.host.id;
  const { width } = useWindowDimensions();
  const wide = isWide(props.layout.compact, width);
  const [days, setDays] = useState<number>(DEFAULT_PERIOD);
  const callOverview = useRpc(assistantOverviewRpc);
  const callStats = useRpc(assistantStatsRpc);
  const base = ["power-workboard", "assistant", hostId] as const;

  const overview = useQuery({
    queryKey: [...base, "overview"],
    queryFn: () => callOverview({}),
    refetchInterval: 5_000,
  });
  const stats = useQuery({
    queryKey: [...base, "stats", days],
    queryFn: () => callStats({ days }),
    refetchInterval: 30_000,
  });

  const left = (
    <>
      <NeedsYouSection props={props} items={overview.data?.needsYou ?? null} />
      <RunningSection
        theme={theme}
        running={overview.data?.running ?? []}
        queued={overview.data?.queued ?? 0}
      />
    </>
  );
  const numbers = (
    <>
      <NumbersSection
        theme={theme}
        stats={stats.data ?? null}
        days={days}
        setDays={setDays}
      />
      {stats.isError ? <ErrorLine theme={theme} error={stats.error} /> : null}
    </>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.foreground }]}>
          {s.title}
        </Text>
        {overview.data ? (
          <View style={styles.statusRow}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: overview.data.enabled
                    ? theme.colors.statusSuccess
                    : theme.colors.foregroundMuted,
                },
              ]}
            />
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {overview.data.enabled ? s.statusOn : s.statusOff}
            </Text>
          </View>
        ) : null}
        {overview.data && !overview.data.enabled ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {s.offHint}
          </Text>
        ) : null}
        {overview.isError ? (
          <ErrorLine theme={theme} error={overview.error} />
        ) : null}
      </View>
      {wide ? (
        <View style={styles.columns}>
          <View style={styles.column}>{left}</View>
          <View style={styles.column}>{numbers}</View>
        </View>
      ) : (
        <>
          {left}
          {numbers}
        </>
      )}
      <ChartsSection theme={theme} stats={stats.data ?? null} wide={wide} />
      <HistorySection props={props} stats={stats.data ?? null} />
    </ScrollView>
  );
}

function ErrorLine({ theme, error }: { theme: Theme; error: unknown }) {
  return (
    <Text style={{ color: theme.colors.statusDanger }}>
      {`${s.loadError}: ${errorMessage(error)}`}
    </Text>
  );
}

function Section({
  theme,
  title,
  children,
}: {
  theme: Theme;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function ProjectChip({
  theme,
  id,
  name,
}: {
  theme: Theme;
  id: string | null;
  name: string;
}) {
  const color = projectColor(id ?? name, theme);
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text
        numberOfLines={1}
        style={{ color: theme.colors.foreground, fontSize: 12 }}
      >
        {name}
      </Text>
    </View>
  );
}

function Button({
  theme,
  label,
  onPress,
  primary,
  disabled,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
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
          opacity: disabled ? 0.5 : 1,
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
}

// ---- Needs you ----

function NeedsYouSection({
  props,
  items,
}: {
  props: Props;
  items: NeedsYouItem[] | null;
}) {
  const { theme } = props;
  return (
    <Section
      theme={theme}
      title={`${s.needsYou}${items?.length ? ` (${items.length})` : ""}`}
    >
      {items === null ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>{s.loading}</Text>
      ) : items.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {s.needsYouEmpty}
        </Text>
      ) : (
        items.map((item) => (
          <NeedsYouCard key={item.taskId} props={props} item={item} />
        ))
      )}
    </Section>
  );
}

export function NeedsYouCard({
  props,
  item,
}: {
  props: Props;
  item: NeedsYouItem;
}) {
  const { theme } = props;
  const callAction = useRpc(assistantActionRpc);
  const cache = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const action = useMutation({
    mutationFn: (input: AssistantActionInput) => callAction(input),
    onSuccess: () => {
      setConfirmMerge(false);
      setFeedbackOpen(false);
      setFeedback("");
      return cache.invalidateQueries({
        queryKey: ["power-workboard", "assistant", props.host.id],
      });
    },
  });
  const run = (input: AssistantActionInput) => action.mutate(input);
  const busy = action.isPending;
  const text = { color: theme.colors.foreground };
  const muted = { color: theme.colors.foregroundMuted };
  const report = item.report;
  const candidate = report?.question ?? report?.summary ?? null;
  // The detail often is the question itself; don't show it twice.
  const reportText =
    candidate && candidate.trim() !== item.detail?.trim() ? candidate : null;
  // CUSTOM(resource-pools): the server's detail is English, for the assistant; this one is translated.
  const locale = usePaseoLocale();
  const detail =
    item.reason === "fix-waiting"
      ? fixWaitedText(item.hold, locale)
      : item.detail;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: theme.colors.statusWarning,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      <Text style={[styles.cardTitle, text]}>{item.title}</Text>
      <View style={styles.metaRow}>
        <ProjectChip
          theme={theme}
          id={item.projectId}
          name={item.projectName}
        />
        <Text style={[styles.meta, muted]}>
          {item.orchestratorName ?? s.manual}
        </Text>
        <Text style={[styles.meta, { color: theme.colors.statusWarning }]}>
          {REASON_LABELS[item.reason]}
        </Text>
        <Text style={[styles.meta, muted]}>{formatAge(item.since)}</Text>
      </View>
      {detail ? (
        <Pressable onPress={() => setExpanded((value) => !value)}>
          <Text
            numberOfLines={expanded ? undefined : COLLAPSED_DETAIL_LINES}
            style={[styles.body, text]}
          >
            {detail}
          </Text>
          <Text style={[styles.meta, muted]}>
            {expanded ? s.showLess : s.showMore}
          </Text>
        </Pressable>
      ) : null}
      {reportText ? (
        <Text style={[styles.body, muted]}>
          {`${report?.question ? s.question : s.summary}: ${reportText}`}
        </Text>
      ) : null}
      {feedbackOpen ? (
        <View style={styles.feedback}>
          <TextInput
            accessibilityLabel={s.continue}
            value={feedback}
            onChangeText={setFeedback}
            multiline
            editable={!busy}
            placeholder={s.feedbackPlaceholder}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[
              styles.input,
              {
                color: theme.colors.foreground,
                borderColor: theme.colors.border,
              },
            ]}
          />
          <View style={styles.actions}>
            <Button
              theme={theme}
              primary
              label={s.sendFeedback}
              disabled={busy || feedback.trim() === ""}
              onPress={() =>
                run({
                  type: "continue",
                  taskId: item.taskId,
                  feedback: feedback.trim(),
                })
              }
            />
            <Button
              theme={theme}
              label={s.cancel}
              disabled={busy}
              onPress={() => setFeedbackOpen(false)}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.actions}>
        {item.canMerge ? (
          confirmMerge ? (
            <>
              <Button
                theme={theme}
                primary
                label={s.confirmMerge}
                disabled={busy}
                onPress={() => run({ type: "merge-now", taskId: item.taskId })}
              />
              <Button
                theme={theme}
                label={s.cancel}
                onPress={() => setConfirmMerge(false)}
              />
            </>
          ) : (
            <Button
              theme={theme}
              primary
              label={s.mergeNow}
              disabled={busy}
              onPress={() => setConfirmMerge(true)}
            />
          )
        ) : null}
        <Button
          theme={theme}
          label={s.continue}
          disabled={busy}
          onPress={() => setFeedbackOpen(true)}
        />
        <Button
          theme={theme}
          label={s.markDone}
          disabled={busy}
          onPress={() => run({ type: "mark-done", taskId: item.taskId })}
        />
        <Button
          theme={theme}
          label={s.dismiss}
          disabled={busy}
          onPress={() => run({ type: "dismiss", taskId: item.taskId })}
        />
        <Button
          theme={theme}
          label={s.openReport}
          onPress={() => showReport(props.navigation, item.taskId)}
        />
        {item.agentId ? (
          <Button
            theme={theme}
            label={s.openConversation}
            onPress={() =>
              showConversation(
                props.navigation,
                item.agentId as string,
                item.taskId,
              )
            }
          />
        ) : null}
      </View>
      {action.isError ? (
        <Text style={{ color: theme.colors.statusDanger }}>
          {errorMessage(action.error)}
        </Text>
      ) : null}
    </View>
  );
}

// ---- Running ----

function RunningSection({
  theme,
  running,
  queued,
}: {
  theme: Theme;
  running: RunningItem[];
  queued: number;
}) {
  // CUSTOM(task-checkpoints): tasks between checkpoints hold no slot, so they list apart.
  const waiting = running.filter((item) => item.stage === "waiting");
  const active = running.filter((item) => item.stage !== "waiting");
  const now = new Date();
  const locale = usePaseoLocale(); // CUSTOM(resource-pools)
  const row = (item: RunningItem, meta: (string | null)[]) => (
    <View
      key={item.taskId}
      style={[styles.runRow, { borderColor: theme.colors.border }]}
    >
      <Text
        numberOfLines={1}
        style={[styles.runTitle, { color: theme.colors.foreground }]}
      >
        {item.title}
      </Text>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {meta.filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
  return (
    <Section theme={theme} title={s.running}>
      {active.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {s.runningEmpty}
        </Text>
      ) : (
        active.map((item) =>
          row(item, [
            item.projectName,
            STAGE_LABELS[item.stage],
            item.attempt ? s.attempt(item.attempt) : null,
            item.progress
              ? progressBadge(item.progress, s.checkpointWord) || null
              : null,
            // CUSTOM(resource-pools): a fix waiting for a pool slot says why.
            item.hold ? fixHoldText(item.hold, locale) : null,
            formatElapsed(item.startedAt),
          ]),
        )
      )}
      {waiting.length > 0 ? (
        <>
          <Text
            style={[styles.runTitle, { color: theme.colors.foregroundMuted }]}
          >
            {s.waitingTitle} ({waiting.length})
          </Text>
          {waiting.map((item) =>
            row(item, [
              item.projectName,
              item.limited // CUSTOM(usage-limit)
                ? s.limitPaused(
                    item.resumeAt ? formatClock(item.resumeAt, now) : null,
                  )
                : item.resumeAt
                  ? s.resumes(formatClock(item.resumeAt, now))
                  : s.nextPass,
              item.waitingFor ?? null,
              item.progress
                ? progressBadge(item.progress, s.checkpointWord) || null
                : null,
            ]),
          )}
        </>
      ) : null}
      {queued > 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {s.queued(queued)}
        </Text>
      ) : null}
    </Section>
  );
}

// ---- Numbers ----

function NumbersSection({
  theme,
  stats,
  days,
  setDays,
}: {
  theme: Theme;
  stats: Stats | null;
  days: number;
  setDays: (days: number) => void;
}) {
  const totals = stats?.totals;
  const dash = "—";
  const num = (value: number | undefined) =>
    value === undefined ? dash : String(value);
  const tiles: [string, string][] = [
    [s.tiles.doneToday, num(totals?.doneToday)],
    [s.tiles.doneInPeriod, num(totals?.doneInPeriod)],
    [s.tiles.mergedInPeriod, num(totals?.mergedInPeriod)],
    [s.tiles.firstTryRate, formatPercent(totals?.firstTryRate ?? null)],
    [s.tiles.averageAttempts, formatDecimal(totals?.averageAttempts ?? null)],
    [
      s.tiles.averageDuration,
      formatDuration(totals?.averageDurationMs ?? null),
    ],
    [s.tiles.needsYou, num(totals?.needsYou)],
    [s.tiles.running, num(totals?.running)],
    [s.tiles.queued, num(totals?.queued)],
  ];
  return (
    <Section theme={theme} title={s.numbers}>
      <View style={styles.actions}>
        {PERIODS.map((period) => (
          <Pressable
            key={period}
            accessibilityRole="button"
            onPress={() => setDays(period)}
            style={[
              styles.periodChip,
              {
                borderColor:
                  period === days ? theme.colors.accent : theme.colors.border,
                backgroundColor:
                  period === days ? theme.colors.surface2 : "transparent",
              },
            ]}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
              {s.period(period)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tiles}>
        {tiles.map(([label, value]) => (
          <View
            key={label}
            style={[
              styles.tile,
              {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface1,
              },
            ]}
          >
            <Text
              style={[styles.tileValue, { color: theme.colors.foreground }]}
            >
              {value}
            </Text>
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

// ---- Charts ----

function ChartsSection({
  theme,
  stats,
  wide,
}: {
  theme: Theme;
  stats: Stats | null;
  wide: boolean;
}) {
  if (!stats) return null;
  const card = [
    styles.chartCard,
    {
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    },
  ];
  const sub = (title: string) => (
    <Text style={[styles.cardTitle, { color: theme.colors.foreground }]}>
      {title}
    </Text>
  );
  return (
    <Section theme={theme} title={s.charts}>
      <View style={card}>
        {sub(s.perDay)}
        <DayChart stats={stats} theme={theme} />
      </View>
      <View style={wide ? styles.columns : undefined}>
        <View style={[card, wide && styles.column]}>
          {sub(s.perProject)}
          <HorizontalBars
            theme={theme}
            rows={stats.perProject.map((row) => ({
              key: row.projectId ?? row.projectName,
              name: row.projectName,
              done: row.done,
              merged: row.merged,
              failed: row.failed,
            }))}
          />
        </View>
        <View style={[card, wide && styles.column]}>
          {sub(s.perOrchestrator)}
          <HorizontalBars
            theme={theme}
            rows={stats.perOrchestrator.map((row) => ({
              key: row.orchestratorId ?? row.name,
              name: row.name,
              done: row.done,
              merged: row.merged,
              failed: row.failed,
            }))}
          />
        </View>
      </View>
    </Section>
  );
}

// ---- History ----

function FilterRow<T extends string>({
  theme,
  label,
  options,
  value,
  onChange,
}: {
  theme: Theme;
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {label}
      </Text>
      <View style={styles.actions}>
        {[{ value: null, label: s.filterAll }, ...options].map((option) => (
          <Pressable
            key={option.value ?? "all"}
            accessibilityRole="button"
            onPress={() => onChange(option.value as T | null)}
            style={[
              styles.periodChip,
              {
                borderColor:
                  option.value === value
                    ? theme.colors.accent
                    : theme.colors.border,
                backgroundColor:
                  option.value === value
                    ? theme.colors.surface2
                    : "transparent",
              },
            ]}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function HistorySection({
  props,
  stats,
}: {
  props: Props;
  stats: Stats | null;
}) {
  const { theme } = props;
  const callHistory = useRpc(assistantHistoryRpc);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [orchestratorId, setOrchestratorId] = useState<string | null>(null);
  const [kind, setKind] = useState<HistoryEventKind | null>(null);
  const history = useInfiniteQuery({
    queryKey: [
      "power-workboard",
      "assistant",
      props.host.id,
      "history",
      projectId,
      orchestratorId,
      kind,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      callHistory({
        cursor: pageParam,
        limit: 50,
        projectId,
        orchestratorId,
        taskId: null,
        kinds: kind ? [kind] : [],
        from: null,
        to: null,
      }),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30_000,
  });
  const events: HistoryEvent[] =
    history.data?.pages.flatMap((page) => page.events) ?? [];
  const projects = (stats?.perProject ?? [])
    .filter((row) => row.projectId)
    .map((row) => ({ value: row.projectId as string, label: row.projectName }));
  const orchestrators = (stats?.perOrchestrator ?? [])
    .filter((row) => row.orchestratorId)
    .map((row) => ({ value: row.orchestratorId as string, label: row.name }));
  const kinds = HISTORY_EVENT_KINDS.map((value) => ({
    value,
    label: KIND_LABELS[value],
  }));

  return (
    <Section theme={theme} title={s.history}>
      <FilterRow
        theme={theme}
        label={s.filterProject}
        options={projects}
        value={projectId}
        onChange={setProjectId}
      />
      <FilterRow
        theme={theme}
        label={s.filterOrchestrator}
        options={orchestrators}
        value={orchestratorId}
        onChange={setOrchestratorId}
      />
      <FilterRow
        theme={theme}
        label={s.filterKind}
        options={kinds}
        value={kind}
        onChange={setKind}
      />
      {history.isError ? (
        <ErrorLine theme={theme} error={history.error} />
      ) : null}
      {history.isPending ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>{s.loading}</Text>
      ) : events.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {s.historyEmpty}
        </Text>
      ) : (
        events.map((event) => (
          <HistoryRow key={event.id} props={props} event={event} />
        ))
      )}
      {history.hasNextPage ? (
        <View style={styles.actions}>
          <Button
            theme={theme}
            label={history.isFetchingNextPage ? s.loading : s.loadMore}
            disabled={history.isFetchingNextPage}
            onPress={() => void history.fetchNextPage()}
          />
        </View>
      ) : null}
    </Section>
  );
}

function HistoryRow({ props, event }: { props: Props; event: HistoryEvent }) {
  const { theme } = props;
  const agentId = event.agentId;
  const content = (
    <View style={[styles.historyRow, { borderColor: theme.colors.border }]}>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {`${formatTime(event.at)} · ${KIND_LABELS[event.kind]}`}
      </Text>
      <View style={styles.metaRow}>
        <Text style={[styles.runTitle, { color: theme.colors.foreground }]}>
          {event.taskTitle}
        </Text>
        <ProjectChip
          theme={theme}
          id={event.projectId}
          name={event.projectName}
        />
      </View>
      <Text style={[styles.body, { color: theme.colors.foregroundMuted }]}>
        {event.text}
      </Text>
    </View>
  );
  if (!agentId) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={s.openConversation}
      onPress={() => showConversation(props.navigation, agentId, event.taskId)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 20 },
  header: { gap: 4 },
  title: { fontSize: 22, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  columns: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0, gap: 20 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "600" },
  card: {
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  meta: { fontSize: 12 },
  body: { fontSize: 13, lineHeight: 18 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  feedback: { gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    minHeight: 64,
    fontSize: 13,
  },
  runRow: { borderBottomWidth: 1, paddingVertical: 6, gap: 2 },
  runTitle: { fontSize: 14, fontWeight: "500" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minWidth: 110,
    flexGrow: 1,
    flexBasis: 110,
  },
  tileValue: { fontSize: 22, fontWeight: "600" },
  periodChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chartCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 8,
    marginBottom: 10,
  },
  filterRow: { gap: 4 },
  historyRow: { borderBottomWidth: 1, paddingVertical: 8, gap: 3 },
});
