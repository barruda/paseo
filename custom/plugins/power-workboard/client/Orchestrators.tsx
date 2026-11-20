import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  ScrollView,
  TextInput,
} from "@getpaseo/plugin/client/react-native";
import {
  orchestratorConfigSchema,
  poolsSchema,
  providerModelSchema, // CUSTOM(bulk-orchestrator-agent)
  type Board,
  type OrchestratorConfig,
  type OrchestratorHold,
  type Pool,
} from "../shared/model";
import type { Mutation } from "../shared/rpc";
import {
  AUTOMATIC_SCHEDULE,
  isAutomaticSchedule,
  timeOfDaySchema,
  type Schedule,
} from "../shared/schedule";
import { ConfirmationModal } from "./ConfirmationModal";
import { HintButton } from "./Hint";
import type { strings } from "./strings";
import { toggleButtonState } from "./web";
import { formatHold } from "./hold-format"; // CUSTOM(resource-pools)
// CUSTOM(agent-profiles)
import {
  AgentFields,
  ProfilePromptField,
  ProfileSkillsMemory,
  useProfileContent,
  type AgentValue,
} from "./Profiles";
import { usePaseoLanguage, usePaseoLocale } from "./paseo-language";
// CUSTOM(workboard-inner-pages)
import {
  WORKBOARD_PAGES,
  workboardPageLabels,
} from "./assistant/workboard-pages";
import { profileStrings } from "./profiles-strings";
import { ASSISTANT_PROFILE, type SkillSelection } from "../shared/profiles";

type Theme = PluginSurfaceProps["theme"];
type Strings = ReturnType<typeof strings>;
type Mutate = (input: Mutation) => Promise<Board | undefined>;
/** CUSTOM(agent-profiles): the tab id of the Projects Assistant's profile. */
export const ASSISTANT_TAB = ASSISTANT_PROFILE;
interface Shared {
  board: Board;
  t: Strings;
  theme: Theme;
  disabled: boolean;
  mutate: Mutate;
  onOpenAgent(agentId: string): void;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function time(at: string, locale: string): string {
  return new Date(at).toLocaleString(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function scheduleSummary(schedule: Schedule, t: Strings): string {
  const panel = t.panel;
  if (schedule.kind === "manual") return panel.scheduleManual;
  if (isAutomaticSchedule(schedule)) return panel.scheduleKinds.automatic;
  const days =
    schedule.days.length === 7
      ? panel.everyDay
      : DAY_ORDER.filter((day) => schedule.days.includes(day))
          .map((day) => panel.days[day])
          .join(" ");
  return schedule.kind === "window"
    ? `${days} ${schedule.start}–${schedule.end}`
    : `${days} ${panel.at} ${schedule.times.join(", ")}`;
}

function projectName(board: Board, id: string | null, t: Strings): string {
  if (id === null) return t.allProjects;
  return board.projects.find((p) => p.id === id)?.name ?? id;
}

/** CUSTOM(resource-pools): why this orchestrator's waiting tasks don't start; null when nothing holds them. */
export function holdSummary(
  hold: OrchestratorHold | null | undefined,
  t: Strings,
): string | null {
  return hold ? formatHold(hold, t.pools, t.locale) : null;
}

/**
 * CUSTOM(resource-pools): in a project with several orchestrators, only the first in the list takes
 * the tasks with no orchestrator chosen. `first`/`other` for those; null for a general
 * orchestrator or the only one of its project.
 */
export function projectRole(
  orchestrators: readonly OrchestratorConfig[],
  config: OrchestratorConfig,
): "first" | "other" | null {
  if (config.projectId === null) return null;
  const same = orchestrators.filter((o) => o.projectId === config.projectId);
  if (same.length < 2) return null;
  return same[0]!.id === config.id ? "first" : "other";
}

/**
 * CUSTOM(resource-pools): the warning on a project's first orchestrator that is disabled while
 * tasks wait for it; the project's other orchestrators won't take them.
 */
export function firstDisabledWarning(
  board: Board,
  config: OrchestratorConfig,
  t: Strings,
): string | null {
  const waiting = board.orchestratorStatus[config.id]?.waiting ?? 0;
  if (
    config.enabled ||
    waiting === 0 ||
    projectRole(board.orchestrators, config) !== "first"
  )
    return null;
  return t.panel.firstDisabled
    .replace("{count}", String(waiting))
    .replace("{project}", projectName(board, config.projectId, t));
}

/** A new orchestrator starts from the board's agent defaults. */
export function newOrchestrator(board: Board, t: Strings) {
  const defaults = board.orchestrator;
  return orchestratorConfigSchema.omit({ id: true }).parse({
    name: `${t.panel.newName} ${board.orchestrators.length + 1}`,
    provider: defaults.provider,
    modeId: defaults.modeId,
    autoAccept: defaults.autoAccept, // CUSTOM(unattended-automation)
    thinkingOptionId: defaults.thinkingOptionId,
    useWorktree: defaults.useWorktree,
    instructions: defaults.instructions,
    schedule: AUTOMATIC_SCHEDULE,
  });
}

/** The list of orchestrators, with their state and quick actions. */
export function OrchestratorsPanel(
  props: Shared & { onOpen(id: string): void; onCreate(): void },
) {
  const { board, t, theme, disabled, mutate } = props;
  const panel = t.panel;
  const profileText = profileStrings(usePaseoLanguage()); // CUSTOM(agent-profiles)
  // CUSTOM(bulk-orchestrator-agent)
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const ids = new Set(board.orchestrators.map((config) => config.id));
    setSelected((previous) => {
      const next = previous.filter((id) => ids.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [board.orchestrators]);
  const selectedConfigs = board.orchestrators.filter((config) =>
    selected.includes(config.id),
  );
  const toggleSelected = (id: string) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.foreground }]}>
          {panel.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={props.onCreate}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.colors.accent,
              opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Icon name="Plus" size={16} color={theme.colors.accentForeground} />
          <Text style={{ color: theme.colors.accentForeground }}>
            {panel.create}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {panel.intro}
      </Text>
      {/* CUSTOM(bulk-orchestrator-agent): what to do with the selected orchestrators */}
      {selectedConfigs.length > 0 && (
        <View
          style={[
            styles.selectionBar,
            {
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.surface1,
            },
          ]}
        >
          <Text style={[styles.rowTitle, { color: theme.colors.foreground }]}>
            {panel.selected.replace("{count}", String(selectedConfigs.length))}
          </Text>
          <View style={styles.inline}>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() =>
                setSelected(board.orchestrators.map((config) => config.id))
              }
              style={[
                styles.button,
                { backgroundColor: theme.colors.surface2 },
                disabled && styles.disabled,
              ]}
            >
              <Text style={{ color: theme.colors.foreground }}>
                {panel.selectAll}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => setSelected([])}
              style={[
                styles.button,
                { backgroundColor: theme.colors.surface2 },
                disabled && styles.disabled,
              ]}
            >
              <Text style={{ color: theme.colors.foreground }}>
                {panel.clearSelection}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => setEditing(true)}
              style={[
                styles.button,
                { backgroundColor: theme.colors.accent },
                disabled && styles.disabled,
              ]}
            >
              <Icon
                name="SlidersHorizontal"
                size={14}
                color={theme.colors.accentForeground}
              />
              <Text style={{ color: theme.colors.accentForeground }}>
                {panel.changeAgent}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      {/* CUSTOM(agent-profiles): the assistant's profile, always first */}
      <View
        style={[
          styles.row,
          {
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${panel.open}: ${profileText.assistantName}`}
          onPress={() => props.onOpen(ASSISTANT_TAB)}
          style={styles.rowMain}
        >
          <View style={styles.inline}>
            <Icon name="Sparkles" size={16} color={theme.colors.accent} />
            <Text style={[styles.rowTitle, { color: theme.colors.foreground }]}>
              {profileText.assistantName}
            </Text>
          </View>
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {profileText.assistantHint}
          </Text>
        </Pressable>
      </View>
      <NightSection {...props} />
      <PoolsSection {...props} />
      {board.orchestrators.length === 0 && (
        <Text style={[styles.empty, { color: theme.colors.foregroundMuted }]}>
          {panel.empty}
        </Text>
      )}
      {board.orchestrators.map((config, index) => {
        const status = board.orchestratorStatus[config.id];
        // CUSTOM(resource-pools)
        const role = projectRole(board.orchestrators, config);
        const warning = firstDisabledWarning(board, config, t);
        const checked = selected.includes(config.id); // CUSTOM(bulk-orchestrator-agent)
        return (
          <View
            key={config.id}
            style={[
              styles.row,
              {
                borderColor: status?.active
                  ? theme.colors.accent
                  : theme.colors.border,
                backgroundColor: theme.colors.surface1,
              },
            ]}
          >
            {/* CUSTOM(bulk-orchestrator-agent) */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`${panel.select}: ${config.name}`}
              accessibilityState={{ checked, disabled }}
              disabled={disabled}
              onPress={() => toggleSelected(config.id)}
              style={styles.checkbox}
            >
              <Icon
                name={checked ? "SquareCheck" : "Square"}
                size={18}
                color={
                  checked ? theme.colors.accent : theme.colors.foregroundMuted
                }
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${panel.open}: ${config.name}`}
              onPress={() => props.onOpen(config.id)}
              style={[styles.rowMain, !config.enabled && styles.dim]}
            >
              <View style={styles.inline}>
                <Icon
                  name="Bot"
                  size={16}
                  color={
                    status?.active
                      ? theme.colors.accent
                      : theme.colors.foregroundMuted
                  }
                />
                <Text
                  style={[styles.rowTitle, { color: theme.colors.foreground }]}
                >
                  {config.name}
                </Text>
                {!config.enabled && (
                  <Text
                    style={[styles.meta, { color: theme.colors.statusWarning }]}
                  >
                    {panel.disabled}
                  </Text>
                )}
              </View>
              <Text
                style={[styles.meta, { color: theme.colors.foregroundMuted }]}
              >
                {[
                  projectName(board, config.projectId, t),
                  scheduleSummary(config.schedule, t),
                  `${status?.running ?? 0}/${config.maxConcurrent} ${panel.running}`,
                  `${status?.waiting ?? 0} ${panel.waiting}`,
                  // CUSTOM(task-checkpoints)
                  status?.paused
                    ? `${status.paused} ${panel.atCheckpoint}`
                    : null,
                  board.settings.pools.find((pool) => pool.id === config.poolId)
                    ?.name ?? null,
                  holdSummary(status?.hold, t),
                  status?.active
                    ? panel.active
                    : status?.nextRunAt
                      ? `${panel.next} ${time(status.nextRunAt, t.locale)}`
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {/* CUSTOM(resource-pools) */}
              {role ? (
                <Text
                  style={[styles.meta, { color: theme.colors.foregroundMuted }]}
                >
                  {role === "first" ? panel.projectFirst : panel.projectOther}
                </Text>
              ) : null}
              {warning ? (
                <Text
                  style={[styles.meta, { color: theme.colors.statusWarning }]}
                >
                  {warning}
                </Text>
              ) : null}
            </Pressable>
            {/* CUSTOM(resource-pools) */}
            <MoveButtons
              config={config}
              index={index}
              count={board.orchestrators.length}
              {...props}
            />
            <EnableToggle config={config} {...props} />
            <RunControls config={config} {...props} />
          </View>
        );
      })}
      {/* CUSTOM(bulk-orchestrator-agent) */}
      {editing && selectedConfigs.length > 0 && (
        <BulkAgentModal
          configs={selectedConfigs}
          t={t}
          theme={theme}
          disabled={disabled}
          mutate={mutate}
          onClose={() => setEditing(false)}
          onApplied={() => {
            setEditing(false);
            setSelected([]);
          }}
        />
      )}
    </ScrollView>
  );
}

/** CUSTOM(bulk-orchestrator-agent): one agent for every selected orchestrator. */
function BulkAgentModal({
  configs,
  t,
  theme,
  disabled,
  mutate,
  onClose,
  onApplied,
}: {
  configs: OrchestratorConfig[];
  t: Strings;
  theme: Theme;
  disabled: boolean;
  mutate: Mutate;
  onClose(): void;
  onApplied(): void;
}) {
  const panel = t.panel;
  const ps = profileStrings(usePaseoLanguage());
  const first = configs[0];
  const [value, setValue] = useState<AgentValue>({
    provider: first?.provider ?? "",
    modeId: first?.modeId ?? "",
    thinkingOptionId: first?.thinkingOptionId ?? "",
    autoAccept: first?.autoAccept ?? true, // CUSTOM(unattended-automation)
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const valid = providerModelSchema.safeParse(value.provider).success;
  const apply = async () => {
    if (disabled || pending || !valid) return;
    setPending(true);
    setFailed(false);
    try {
      const ok = !!(await mutate({
        action: "orchestrators-set-agent",
        ids: configs.map((config) => config.id),
        provider: value.provider,
        modeId: value.modeId.trim() || null,
        thinkingOptionId: value.thinkingOptionId.trim() || null,
        autoAccept: value.autoAccept, // CUSTOM(unattended-automation)
      }));
      if (ok) onApplied();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open
      title={panel.changeAgentTitle.replace("{count}", String(configs.length))}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Modal.Content>
        <AgentFields
          value={value}
          onChange={setValue}
          disabled={disabled || pending}
          theme={theme}
          s={ps}
        />
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {panel.changeAgentHint}
        </Text>
        {failed && (
          <Text style={{ color: theme.colors.statusDanger }}>
            {t.confirmationFailed}
          </Text>
        )}
        <View style={styles.modalActions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onClose}
            style={[
              styles.button,
              { backgroundColor: theme.colors.surface2 },
              pending && styles.disabled,
            ]}
          >
            <Text style={{ color: theme.colors.foreground }}>{t.cancel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: pending }}
            disabled={disabled || pending || !valid}
            onPress={() => void apply()}
            style={[
              styles.button,
              { backgroundColor: theme.colors.accent },
              (disabled || pending || !valid) && styles.disabled,
            ]}
          >
            <Text style={{ color: theme.colors.accentForeground }}>
              {pending ? t.working : panel.apply}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

type PoolRow = { id: string; name: string; max: string; floor: string };
const toRows = (pools: Pool[]): PoolRow[] =>
  pools.map((pool) => ({
    id: pool.id,
    name: pool.name,
    max: String(pool.maxConcurrent),
    floor:
      pool.minFreeRamPercent === null ? "" : String(pool.minFreeRamPercent),
  }));
const fromRows = (rows: PoolRow[]) =>
  poolsSchema.safeParse(
    rows.map((row) => ({
      id: row.id,
      name: row.name.trim(),
      maxConcurrent: Number(row.max),
      minFreeRamPercent: row.floor.trim() === "" ? null : Number(row.floor),
    })),
  );

/** CUSTOM(resource-pools): the limits several orchestrators share. */
function PoolsSection({ board, t, theme, disabled, mutate }: Shared) {
  const text = t.pools;
  const saved = board.settings.pools;
  const savedKey = JSON.stringify(toRows(saved));
  const [rows, setRows] = useState<PoolRow[]>(toRows(saved));
  // Each snapshot brings a new array; only a real change on the host resets the edits.
  useEffect(() => setRows(JSON.parse(savedKey) as PoolRow[]), [savedKey]);
  const parsed = fromRows(rows);
  const changed = JSON.stringify(rows) !== savedKey;
  const saveDisabled = disabled || !parsed.success || !changed;
  const update = (id: string, change: Partial<PoolRow>) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const input = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    valid: boolean,
    placeholder?: string,
  ) => (
    <View style={styles.field}>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[
          styles.input,
          {
            color: theme.colors.foreground,
            borderColor: valid
              ? theme.colors.border
              : theme.colors.statusDanger,
          },
        ]}
      />
    </View>
  );
  const integer = (value: string, min: number, max: number) =>
    /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.inline}>
        <Icon name="Gauge" size={16} color={theme.colors.foregroundMuted} />
        <Text style={[styles.label, { color: theme.colors.foreground }]}>
          {text.title}
        </Text>
      </View>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {text.intro}
      </Text>
      {rows.length === 0 && (
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {text.empty}
        </Text>
      )}
      {rows.map((row) => (
        <View key={row.id} style={styles.inline}>
          {input(
            text.name,
            row.name,
            (name) => update(row.id, { name }),
            row.name.trim() !== "",
          )}
          {input(
            text.maxConcurrent,
            row.max,
            (max) => update(row.id, { max }),
            integer(row.max, 1, 10),
          )}
          {input(
            text.minFreeRam,
            row.floor,
            (floor) => update(row.id, { floor }),
            row.floor.trim() === "" || integer(row.floor, 1, 95),
            text.minFreeRamPlaceholder,
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${text.remove}: ${row.name}`}
            disabled={disabled}
            onPress={() => setRows(rows.filter((r) => r.id !== row.id))}
            style={[
              styles.button,
              { backgroundColor: theme.colors.surface2 },
              disabled && styles.disabled,
            ]}
          >
            <Text style={{ color: theme.colors.foreground }}>
              {text.remove}
            </Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.inline}>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() =>
            setRows([
              ...rows,
              {
                id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
                name: "Pool",
                max: "1",
                floor: "",
              },
            ])
          }
          style={[
            styles.button,
            { backgroundColor: theme.colors.surface2 },
            disabled && styles.disabled,
          ]}
        >
          <Text style={{ color: theme.colors.foreground }}>{text.add}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={saveDisabled}
          onPress={() =>
            parsed.success &&
            void mutate({ action: "pools-save", pools: parsed.data })
          }
          style={[
            styles.button,
            {
              backgroundColor: saveDisabled
                ? theme.colors.surface2
                : theme.colors.accent,
            },
          ]}
        >
          <Text
            style={{
              color: saveDisabled
                ? theme.colors.foregroundMuted
                : theme.colors.accentForeground,
            }}
          >
            {text.save}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Night window, power-off option and what the night runner did lately. */
function NightSection({ board, t, theme, disabled, mutate }: Shared) {
  const night = t.night;
  const saved = board.night;
  const [start, setStart] = useState(saved.start);
  const [end, setEnd] = useState(saved.end);
  const [shutdown, setShutdown] = useState(saved.shutdownWhenDone);
  const [command, setCommand] = useState(saved.shutdownCommand);
  useEffect(() => {
    setStart(saved.start);
    setEnd(saved.end);
    setShutdown(saved.shutdownWhenDone);
    setCommand(saved.shutdownCommand);
  }, [saved.start, saved.end, saved.shutdownWhenDone, saved.shutdownCommand]);
  const valid =
    timeOfDaySchema.safeParse(start).success &&
    timeOfDaySchema.safeParse(end).success;
  const changed =
    start !== saved.start ||
    end !== saved.end ||
    shutdown !== saved.shutdownWhenDone ||
    command.trim() !== saved.shutdownCommand;
  const saveDisabled = disabled || !valid || !changed;
  const status = board.nightStatus;
  const statusText = [
    status.open
      ? night.open
      : status.nextStartAt
        ? night.opensAt.replace(
            "{time}",
            new Date(status.nextStartAt).toLocaleString(t.locale, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
          )
        : night.title,
    night.waiting.replace("{count}", String(status.waiting)),
  ].join(" · ");
  const timeInput = (
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        placeholder="HH:MM"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[
          styles.input,
          {
            color: theme.colors.foreground,
            borderColor: timeOfDaySchema.safeParse(value).success
              ? theme.colors.border
              : theme.colors.statusDanger,
          },
        ]}
      />
    </View>
  );
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.inline}>
        <Icon name="Moon" size={16} color={theme.colors.foregroundMuted} />
        <Text style={[styles.label, { color: theme.colors.foreground }]}>
          {night.title}
        </Text>
      </View>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {statusText}
      </Text>
      <View style={styles.inline}>
        {timeInput(night.from, start, setStart)}
        {timeInput(night.to, end, setEnd)}
      </View>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {night.windowHint}
      </Text>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={night.shutdown}
        {...toggleButtonState(shutdown)}
        disabled={disabled}
        onPress={() => setShutdown(!shutdown)}
        style={[styles.toggle, disabled && styles.disabled]}
      >
        <View
          style={[
            styles.track,
            {
              backgroundColor: shutdown
                ? theme.colors.accent
                : theme.colors.surface2,
              borderColor: shutdown ? theme.colors.accent : theme.colors.border,
              alignItems: shutdown ? "flex-end" : "flex-start",
            },
          ]}
        >
          <View
            style={[
              styles.knob,
              {
                backgroundColor: shutdown
                  ? theme.colors.accentForeground
                  : theme.colors.foregroundMuted,
              },
            ]}
          />
        </View>
        <Text style={{ color: theme.colors.foreground }}>{night.shutdown}</Text>
      </Pressable>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {night.shutdownHint}
      </Text>
      {shutdown && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.colors.foreground }]}>
            {night.command}
          </Text>
          <TextInput
            accessibilityLabel={night.command}
            editable={!disabled}
            value={command}
            onChangeText={setCommand}
            placeholder={night.commandPlaceholder}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[
              styles.input,
              {
                color: theme.colors.foreground,
                borderColor: theme.colors.border,
              },
            ]}
          />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={saveDisabled}
        onPress={() =>
          void mutate({
            action: "night-settings",
            night: {
              start,
              end,
              shutdownWhenDone: shutdown,
              shutdownCommand: command.trim(),
            },
          })
        }
        style={[
          styles.button,
          styles.deleteButton,
          {
            backgroundColor: saveDisabled
              ? theme.colors.surface2
              : theme.colors.accent,
          },
        ]}
      >
        <Text
          style={{
            color: saveDisabled
              ? theme.colors.foregroundMuted
              : theme.colors.accentForeground,
          }}
        >
          {night.save}
        </Text>
      </Pressable>
      {board.nightRuntime.log.length > 0 && (
        <View style={styles.stack}>
          <Text style={[styles.label, { color: theme.colors.foreground }]}>
            {night.log}
          </Text>
          {board.nightRuntime.log
            .slice(-5)
            .reverse()
            .map((entry, index) => (
              <View key={`${entry.at}-${index}`} style={styles.logRow}>
                <Text
                  style={[
                    styles.logTime,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  {time(entry.at, t.locale)}
                </Text>
                <Text
                  style={[
                    styles.meta,
                    { color: theme.colors.foregroundMuted, flex: 1 },
                  ]}
                >
                  {entry.text}
                </Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

function RunControls({
  config,
  board,
  t,
  theme,
  disabled,
  mutate,
}: Shared & { config: OrchestratorConfig }) {
  const runtime = board.orchestratorRuntime[config.id];
  const running = (runtime?.quota ?? 0) > 0;
  const off = !config.enabled;
  disabled = disabled || off;
  return (
    <HintButton
      hint={
        off
          ? t.panel.disabledRunHint
          : running
            ? t.panel.stopHint
            : t.panel.runHint
      }
      accessibilityRole="button"
      accessibilityLabel={running ? t.panel.stop : t.panel.run}
      disabled={disabled}
      onPress={() =>
        void mutate({
          action: running ? "orchestrator-stop" : "orchestrator-run",
          id: config.id,
        })
      }
      style={({ pressed }) => [
        styles.button,
        {
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surface2 : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Icon
        name={running ? "Square" : "Play"}
        size={14}
        color={theme.colors.foreground}
      />
      <Text style={{ color: theme.colors.foreground }}>
        {running ? t.panel.stop : t.panel.run}
      </Text>
    </HintButton>
  );
}

/** A compact on/off switch that saves right away; it is not part of the editor form. */
/** CUSTOM(resource-pools): moves an orchestrator up or down the list. */
function MoveButtons({
  config,
  index,
  count,
  t,
  theme,
  disabled,
  mutate,
}: Shared & { config: OrchestratorConfig; index: number; count: number }) {
  if (count < 2) return null;
  const button = (direction: "up" | "down", off: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${direction === "up" ? t.panel.moveUp : t.panel.moveDown}: ${config.name}`}
      disabled={disabled || off}
      onPress={() =>
        void mutate({ action: "orchestrator-move", id: config.id, direction })
      }
      style={({ pressed }) => [
        styles.moveButton,
        {
          backgroundColor: pressed ? theme.colors.surface2 : "transparent",
          opacity: disabled || off ? 0.3 : 1,
        },
      ]}
    >
      <Icon
        name={direction === "up" ? "ChevronUp" : "ChevronDown"}
        size={16}
        color={theme.colors.foregroundMuted}
      />
    </Pressable>
  );
  return (
    <View style={styles.moveButtons}>
      {button("up", index === 0)}
      {button("down", index === count - 1)}
    </View>
  );
}

function EnableToggle({
  config,
  t,
  theme,
  disabled,
  mutate,
}: Shared & { config: OrchestratorConfig }) {
  const on = config.enabled;
  return (
    <HintButton
      hint={t.panel.enableHint}
      accessibilityRole="switch"
      accessibilityLabel={t.panel.enabled}
      {...toggleButtonState(on)}
      disabled={disabled}
      onPress={() =>
        void mutate({
          action: "orchestrator-enable",
          id: config.id,
          enabled: !on,
        })
      }
      style={[styles.toggle, disabled && styles.disabled]}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: on ? theme.colors.accent : theme.colors.surface2,
            borderColor: on ? theme.colors.accent : theme.colors.border,
            alignItems: on ? "flex-end" : "flex-start",
          },
        ]}
      >
        <View
          style={[
            styles.knob,
            {
              backgroundColor: on
                ? theme.colors.accentForeground
                : theme.colors.foregroundMuted,
            },
          ]}
        />
      </View>
      <Text style={{ color: theme.colors.foreground }}>{t.panel.enabled}</Text>
    </HintButton>
  );
}

type SubTab = "overview" | "general" | "schedule" | "agent" | "prompts";
const SUB_TABS: SubTab[] = [
  "overview",
  "general",
  "schedule",
  "agent",
  "prompts",
];

type Draft = {
  name: string;
  projectId: string | null;
  poolId: string | null; // CUSTOM(resource-pools)
  kind: Schedule["kind"] | "automatic";
  days: number[];
  start: string;
  end: string;
  times: string;
  maxConcurrent: string;
  batchSize: string;
  maxCheckpoints: string; // CUSTOM(task-checkpoints)
  provider: string;
  modeId: string;
  autoAccept: boolean; // CUSTOM(unattended-automation)
  thinkingOptionId: string;
  useWorktree: boolean;
  instructions: string;
  skills: SkillSelection; // CUSTOM(agent-profiles)
  memory: boolean;
};
function toDraft(config: OrchestratorConfig): Draft {
  const schedule = config.schedule;
  return {
    name: config.name,
    projectId: config.projectId,
    poolId: config.poolId,
    kind: isAutomaticSchedule(schedule) ? "automatic" : schedule.kind,
    days: schedule.kind === "manual" ? [0, 1, 2, 3, 4, 5, 6] : schedule.days,
    start: schedule.kind === "window" ? schedule.start : "22:00",
    end: schedule.kind === "window" ? schedule.end : "06:00",
    times: schedule.kind === "daily" ? schedule.times.join(", ") : "09:00",
    maxConcurrent: String(config.maxConcurrent),
    batchSize: String(config.batchSize),
    maxCheckpoints: String(config.maxCheckpoints), // CUSTOM(task-checkpoints)
    provider: config.provider,
    modeId: config.modeId ?? "",
    autoAccept: config.autoAccept,
    thinkingOptionId: config.thinkingOptionId ?? "",
    useWorktree: config.useWorktree,
    instructions: config.instructions,
    skills: config.skills,
    memory: config.memory,
  };
}
/** Enabled is not part of the form: Save keeps the switch as it is. */
function fromDraft(id: string, draft: Draft, enabled: boolean) {
  const schedule =
    draft.kind === "manual"
      ? { kind: "manual" }
      : draft.kind === "automatic"
        ? AUTOMATIC_SCHEDULE
        : draft.kind === "window"
          ? {
              kind: "window",
              days: draft.days,
              start: draft.start.trim(),
              end: draft.end.trim(),
            }
          : {
              kind: "daily",
              days: draft.days,
              times: draft.times
                .split(/[,\s]+/)
                .map((value) => value.trim())
                .filter(Boolean),
            };
  return orchestratorConfigSchema.safeParse({
    id,
    name: draft.name,
    projectId: draft.projectId,
    poolId: draft.poolId,
    enabled,
    schedule,
    maxConcurrent: Number(draft.maxConcurrent),
    batchSize: Number(draft.batchSize),
    maxCheckpoints: Number(draft.maxCheckpoints), // CUSTOM(task-checkpoints)
    provider: draft.provider,
    modeId: draft.modeId.trim() || null,
    autoAccept: draft.autoAccept,
    thinkingOptionId: draft.thinkingOptionId.trim() || null,
    useWorktree: draft.useWorktree,
    instructions: draft.instructions,
    skills: draft.skills,
    memory: draft.memory,
  });
}

/** One orchestrator in its own tab: its settings, the tasks it runs, and its log. */
export function OrchestratorTab(
  props: Shared & { id: string; onDeleted(): void },
) {
  const { board, t, theme, disabled, mutate } = props;
  const panel = t.panel;
  const config = board.orchestrators.find((o) => o.id === props.id);
  const [draft, setDraft] = useState<Draft | null>(
    config ? toDraft(config) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>("overview");
  const ps = profileStrings(usePaseoLanguage()); // CUSTOM(agent-profiles)
  const content = useProfileContent(props.id);
  // Pick up a save from another window only while nothing is being edited here.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (config && !dirty) setDraft(toDraft(config));
  }, [config, dirty]);
  if (!config || !draft)
    return (
      <Text style={[styles.empty, { color: theme.colors.foregroundMuted }]}>
        {panel.gone}
      </Text>
    );
  const edit = (change: Partial<Draft>) => {
    setDirty(true);
    setDraft({ ...draft, ...change });
  };
  const save = async () => {
    const parsed = fromDraft(config.id, draft, config.enabled);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" · "),
      );
      return;
    }
    setError(null);
    if (
      await mutate({ action: "orchestrator-save", orchestrator: parsed.data })
    ) {
      setDirty(false);
      // CUSTOM(agent-profiles): the system prompt is saved with the form.
      try {
        await content.save();
      } catch (failure) {
        setError(
          `${ps.saveFailed}: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
      }
    }
  };
  const runs = Object.entries(board.orchestrations)
    .filter(
      ([, record]) =>
        record.orchestratorId === config.id &&
        (record.status === "starting" || record.status === "running"),
    )
    .map(([taskId, record]) => ({
      record,
      card: board.cards.find((card) => card.id === taskId),
    }));
  const log = [...(board.orchestratorLogs[config.id] ?? [])].reverse();
  const field = (label: string, child: ReactNode, hint?: string) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {label}
      </Text>
      {child}
      {hint && (
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {hint}
        </Text>
      )}
    </View>
  );
  const input = (
    value: string,
    onChange: (value: string) => void,
    options: { multiline?: boolean; label: string; placeholder?: string } = {
      label: "",
    },
  ) => (
    <TextInput
      accessibilityLabel={options.label}
      editable={!disabled}
      value={value}
      onChangeText={onChange}
      multiline={options.multiline}
      placeholder={options.placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      style={[
        styles.input,
        options.multiline && styles.textarea,
        { color: theme.colors.foreground, borderColor: theme.colors.border },
      ]}
    />
  );
  const chip = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    hint?: string,
  ) => {
    const common = {
      accessibilityRole: "button" as const,
      ...toggleButtonState(selected),
      disabled,
      onPress,
      style: [
        styles.chip,
        { borderColor: theme.colors.border },
        selected && { backgroundColor: theme.colors.surface2 },
        disabled && styles.disabled,
      ],
      children: <Text style={{ color: theme.colors.foreground }}>{label}</Text>,
    };
    return hint ? (
      <HintButton key={key} hint={hint} {...common} />
    ) : (
      <Pressable key={key} {...common} />
    );
  };
  const state = board.orchestratorStatus[config.id];
  const pill = !config.enabled
    ? { text: panel.disabled, color: theme.colors.statusWarning }
    : state?.active
      ? { text: panel.active, color: theme.colors.accent }
      : state?.nextRunAt
        ? {
            text: panel.nextRun.replace(
              "{time}",
              time(state.nextRunAt, t.locale),
            ),
            color: theme.colors.foregroundMuted,
          }
        : { text: panel.idle, color: theme.colors.foregroundMuted };
  const unsaved = dirty || content.touched;
  const section = (title: string, children: ReactNode) => (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
  const stat = (label: string, value: string, color?: string) => (
    <View
      key={label}
      style={[
        styles.stat,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </Text>
      <Text
        style={[styles.statValue, { color: color ?? theme.colors.foreground }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
  const overview = (
    <View style={styles.stack}>
      <View style={styles.stats}>
        {stat(
          panel.running,
          `${state?.running ?? runs.length}/${config.maxConcurrent}`,
        )}
        {stat(panel.waiting, String(state?.waiting ?? 0))}
        {/* CUSTOM(task-checkpoints) */}
        {state?.paused
          ? stat(panel.atCheckpointStat, String(state.paused))
          : null}
        {config.enabled && !state?.active && state?.nextRunAt
          ? stat(panel.statNext, time(state.nextRunAt, t.locale))
          : stat(panel.statState, pill.text, pill.color)}
      </View>
      {holdSummary(state?.hold, t) && (
        <Text style={[styles.meta, { color: theme.colors.statusWarning }]}>
          {holdSummary(state?.hold, t)}
        </Text>
      )}
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {panel.runningNow} ({runs.length}/{config.maxConcurrent})
      </Text>
      {runs.length === 0 && (
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {panel.nothingRunning}
        </Text>
      )}
      {runs.map(({ record, card }) => (
        <View key={record.agentId ?? record.startedAt} style={styles.inline}>
          <Text
            style={[styles.meta, { color: theme.colors.foreground, flex: 1 }]}
            numberOfLines={1}
          >
            {card?.title ?? "?"} · {t.orchestrationStatus[record.status]}
          </Text>
          {record.agentId && <AgentLink agentId={record.agentId} {...props} />}
        </View>
      ))}
      <Text
        style={[
          styles.label,
          styles.logTitle,
          { color: theme.colors.foreground },
        ]}
      >
        {panel.log}
      </Text>
      {log.length === 0 && (
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {panel.logEmpty}
        </Text>
      )}
      {log.map((entry, index) => (
        <View key={`${entry.at}:${index}`} style={styles.logRow}>
          <Text
            style={[styles.logTime, { color: theme.colors.foregroundMuted }]}
          >
            {time(entry.at, t.locale)}
          </Text>
          <Text
            style={[
              styles.meta,
              {
                flex: 1,
                color:
                  entry.level === "error"
                    ? theme.colors.statusDanger
                    : entry.level === "warn"
                      ? theme.colors.statusWarning
                      : theme.colors.foreground,
              },
            ]}
          >
            {entry.text}
          </Text>
          {entry.agentId && <AgentLink agentId={entry.agentId} {...props} />}
        </View>
      ))}
    </View>
  );
  const general = (
    <>
      {section(
        panel.sections.identity,
        <>
          {field(
            panel.name,
            input(draft.name, (name) => edit({ name }), { label: panel.name }),
          )}
          {field(
            panel.project,
            <View style={styles.chips}>
              {chip("all", t.allProjects, draft.projectId === null, () =>
                edit({ projectId: null }),
              )}
              {board.projects.map((project) =>
                chip(
                  project.id,
                  project.name,
                  draft.projectId === project.id,
                  () => edit({ projectId: project.id }),
                ),
              )}
            </View>,
            panel.projectHint,
          )}
          {board.settings.pools.length > 0 &&
            field(
              t.pools.label,
              <View style={styles.chips}>
                {chip("no-pool", t.pools.none, draft.poolId === null, () =>
                  edit({ poolId: null }),
                )}
                {board.settings.pools.map((pool) =>
                  chip(pool.id, pool.name, draft.poolId === pool.id, () =>
                    edit({ poolId: pool.id }),
                  ),
                )}
              </View>,
              t.pools.poolHint,
            )}
          {field(
            panel.workspace,
            <View style={styles.chips}>
              {chip("worktree", panel.worktree, draft.useWorktree, () =>
                edit({ useWorktree: true }),
              )}
              {chip("folder", panel.folder, !draft.useWorktree, () =>
                edit({ useWorktree: false }),
              )}
            </View>,
          )}
        </>,
      )}
      {section(
        panel.dangerZone,
        <>
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {panel.dangerHint}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => setDeleting(true)}
            style={[styles.button, styles.deleteButton]}
          >
            <Icon name="Trash2" size={14} color={theme.colors.statusDanger} />
            <Text style={{ color: theme.colors.statusDanger }}>
              {panel.delete}
            </Text>
          </Pressable>
        </>,
      )}
    </>
  );
  const schedule = (
    <>
      {section(
        panel.sections.scheduleWhen,
        <>
          {field(
            panel.schedule,
            <View style={styles.chips}>
              {(["automatic", "window", "daily", "manual"] as const).map(
                (kind) =>
                  chip(
                    kind,
                    panel.scheduleKinds[kind],
                    draft.kind === kind,
                    () => edit({ kind }),
                    panel.scheduleHints[kind],
                  ),
              )}
            </View>,
            panel.scheduleHints[draft.kind],
          )}
          {draft.kind !== "manual" &&
            draft.kind !== "automatic" &&
            field(
              panel.daysLabel,
              <View style={styles.chips}>
                {DAY_ORDER.map((day) =>
                  chip(
                    String(day),
                    panel.days[day],
                    draft.days.includes(day),
                    () =>
                      edit({
                        days: draft.days.includes(day)
                          ? draft.days.filter((d) => d !== day)
                          : [...draft.days, day],
                      }),
                  ),
                )}
              </View>,
            )}
          {draft.kind === "window" && (
            <View style={styles.inline}>
              {field(
                panel.from,
                input(draft.start, (start) => edit({ start }), {
                  label: panel.from,
                  placeholder: "22:00",
                }),
              )}
              {field(
                panel.to,
                input(draft.end, (end) => edit({ end }), {
                  label: panel.to,
                  placeholder: "06:00",
                }),
              )}
            </View>
          )}
          {draft.kind === "daily" &&
            field(
              panel.times,
              input(draft.times, (times) => edit({ times }), {
                label: panel.times,
                placeholder: "09:00, 18:00",
              }),
            )}
        </>,
      )}
      {section(
        panel.sections.scheduleHow,
        <View style={styles.inline}>
          {field(
            panel.maxConcurrent,
            input(
              draft.maxConcurrent,
              (maxConcurrent) => edit({ maxConcurrent }),
              { label: panel.maxConcurrent },
            ),
          )}
          {field(
            panel.batchSize,
            input(draft.batchSize, (batchSize) => edit({ batchSize }), {
              label: panel.batchSize,
            }),
          )}
          {/* CUSTOM(task-checkpoints) */}
          {field(
            panel.maxCheckpoints,
            input(
              draft.maxCheckpoints,
              (maxCheckpoints) => edit({ maxCheckpoints }),
              { label: panel.maxCheckpoints },
            ),
            panel.maxCheckpointsHint,
          )}
        </View>,
      )}
    </>
  );
  const profileProps = {
    profile: config.id,
    content,
    skills: draft.skills,
    memory: draft.memory,
    provider: draft.provider,
    onSkills: (skills: SkillSelection) => edit({ skills }),
    onMemory: (memory: boolean) => edit({ memory }),
    disabled,
    theme,
    s: ps,
  };
  const agent = (
    <>
      {section(
        panel.sections.agent,
        /* CUSTOM(agent-profiles): selects backed by the daemon's catalog */
        <AgentFields
          value={{
            provider: draft.provider,
            modeId: draft.modeId,
            autoAccept: draft.autoAccept,
            thinkingOptionId: draft.thinkingOptionId,
          }}
          onChange={(change) => edit(change)}
          disabled={disabled}
          theme={theme}
          s={ps}
        />,
      )}
      {section(
        panel.sections.skillsMemory,
        <ProfileSkillsMemory {...profileProps} />,
      )}
    </>
  );
  const prompts = (
    <>
      {section(
        panel.sections.instructions,
        field(
          panel.instructions,
          input(draft.instructions, (instructions) => edit({ instructions }), {
            label: panel.instructions,
            multiline: true,
            placeholder: panel.instructionsPlaceholder,
          }),
          ps.instructionsHint, // CUSTOM(agent-profiles)
        ),
      )}
      {section(
        panel.sections.systemPrompt,
        <ProfilePromptField {...profileProps} />,
      )}
    </>
  );
  const pages = { general, schedule, agent, prompts };
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <View style={styles.inline}>
          <Text style={[styles.title, { color: theme.colors.foreground }]}>
            {config.name}
          </Text>
          <Text
            style={[
              styles.pill,
              { color: pill.color, borderColor: pill.color },
            ]}
          >
            {pill.text}
          </Text>
        </View>
        <View style={styles.inline}>
          <EnableToggle config={config} {...props} />
          <RunControls config={config} {...props} />
          {unsaved && (
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {panel.unsaved}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={disabled || !unsaved}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: theme.colors.accent,
                opacity: disabled || !unsaved ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={{ color: theme.colors.accentForeground }}>
              {panel.save}
            </Text>
          </Pressable>
        </View>
      </View>
      {error && (
        <Text style={[styles.meta, { color: theme.colors.statusDanger }]}>
          {error}
        </Text>
      )}
      <View style={[styles.subTabs, { borderColor: theme.colors.border }]}>
        {SUB_TABS.map((id) => {
          const selected = id === subTab;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              {...toggleButtonState(selected)}
              onPress={() => setSubTab(id)}
              style={[
                styles.subTab,
                selected && { borderColor: theme.colors.accent },
              ]}
            >
              <Text
                style={{
                  color: selected
                    ? theme.colors.foreground
                    : theme.colors.foregroundMuted,
                }}
              >
                {panel.subTabs[id]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {subTab === "overview" ? (
        overview
      ) : (
        <View style={styles.settings}>{pages[subTab]}</View>
      )}
      {deleting && (
        <ConfirmationModal
          title={panel.delete}
          description={panel.deleteConfirm.replace("{name}", config.name)}
          confirmLabel={panel.delete}
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const ok = !!(await mutate({
              action: "orchestrator-delete",
              id: config.id,
            }));
            if (ok) props.onDeleted();
            return ok;
          }}
        />
      )}
    </ScrollView>
  );
}

function AgentLink({
  agentId,
  t,
  theme,
  onOpenAgent,
}: Shared & { agentId: string }) {
  return (
    <HintButton
      hint={t.openAgentHint}
      accessibilityRole="link"
      accessibilityLabel={t.openAgent}
      onPress={() => onOpenAgent(agentId)}
      style={styles.link}
    >
      <Text
        style={[
          styles.meta,
          { color: theme.colors.accent, textDecorationLine: "underline" },
        ]}
      >
        {t.openAgent}
      </Text>
    </HintButton>
  );
}

/**
 * Board | Orchestrators | Assistant | Dashboard | Conversations | Reports | one tab per opened
 * orchestrator. CUSTOM(workboard-inner-pages): the four Projects Assistant pages.
 */
export function WorkboardTabs({
  board,
  t,
  theme,
  tab,
  open,
  onSelect,
  onClose,
}: {
  board: Board;
  t: Strings;
  theme: Theme;
  tab: string;
  open: string[];
  onSelect(tab: string): void;
  onClose(id: string): void;
}) {
  const language = usePaseoLanguage(); // CUSTOM(agent-profiles)
  const pageLabels = workboardPageLabels(usePaseoLocale()); // CUSTOM(workboard-inner-pages)
  const active = Object.values(board.orchestratorStatus).filter(
    (status) => status.active,
  ).length;
  const tabs = [
    { id: "board", label: t.panel.boardTab, icon: "Columns3", closable: false },
    {
      id: "orchestrators",
      label: active
        ? `${t.panel.title} · ${active} ${t.panel.active.toLowerCase()}`
        : t.panel.title,
      icon: "Bot",
      closable: false,
    },
    // CUSTOM(workboard-inner-pages)
    ...WORKBOARD_PAGES.map((page) => ({
      id: page.tab,
      label: pageLabels[page.tab],
      icon: page.icon,
      closable: false,
    })),
    ...open.map((id) => ({
      id,
      label:
        id === ASSISTANT_TAB
          ? profileStrings(language).assistantName
          : (board.orchestrators.find((o) => o.id === id)?.name ?? "?"),
      icon: id === ASSISTANT_TAB ? "Sparkles" : "Bot", // CUSTOM(agent-profiles)
      closable: true,
    })),
  ];
  return (
    <View style={[styles.tabs, { borderColor: theme.colors.border }]}>
      {tabs.map((item) => {
        const selected = item.id === tab;
        return (
          <View
            key={item.id}
            style={[
              styles.tab,
              selected && {
                borderColor: theme.colors.accent,
                backgroundColor: theme.colors.surface1,
              },
            ]}
          >
            <Pressable
              accessibilityRole="tab"
              testID={`workboard-tab-${item.id}`}
              {...toggleButtonState(selected)}
              onPress={() => onSelect(item.id)}
              style={styles.inline}
            >
              <Icon
                name={item.icon}
                size={14}
                color={
                  selected
                    ? theme.colors.foreground
                    : theme.colors.foregroundMuted
                }
              />
              <Text
                style={{
                  color: selected
                    ? theme.colors.foreground
                    : theme.colors.foregroundMuted,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
            {item.closable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.panel.closeTab}: ${item.label}`}
                onPress={() => onClose(item.id)}
                style={styles.close}
              >
                <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, maxWidth: 1200 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 18, fontWeight: "600" },
  meta: { fontSize: 12, lineHeight: 16 },
  empty: { padding: 24, textAlign: "center" },
  button: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deleteButton: { alignSelf: "flex-start" },
  // CUSTOM(resource-pools)
  moveButtons: { gap: 2 },
  moveButton: { borderRadius: 6, padding: 2 },
  row: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  // CUSTOM(bulk-orchestrator-agent)
  selectionBar: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  checkbox: { padding: 6, borderRadius: 6 },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 8,
  },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  stack: { gap: 10 },
  dim: { opacity: 0.6 },
  settings: { width: "100%", maxWidth: 760, alignSelf: "center", gap: 14 },
  section: { borderWidth: 1, borderRadius: 10, padding: 16, gap: 14 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: {
    flexGrow: 1,
    flexBasis: 140,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  statValue: { fontSize: 18, fontWeight: "600" },
  pill: {
    fontSize: 12,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  track: {
    width: 34,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
    justifyContent: "center",
  },
  knob: { width: 14, height: 14, borderRadius: 7 },
  subTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  field: { gap: 6, flexGrow: 1 },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    minHeight: 36,
    minWidth: 120,
    flexGrow: 1,
  },
  textarea: { minHeight: 96, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  disabled: { opacity: 0.5 },
  logTitle: { marginTop: 12 },
  logRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  logTime: { fontSize: 12, lineHeight: 16, minWidth: 96 },
  link: { paddingHorizontal: 4 },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  close: { padding: 2, borderRadius: 4 },
});
