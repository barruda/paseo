import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsRpc } from "@getpaseo/plugin";
import {
  JEV_ROUTER_EFFORTS,
  JEV_ROUTER_SETTINGS_ID,
  JEV_UPGRADE_EFFORTS,
  JevRouterSettingsSchema,
  formatClaudeModel,
  type JevRouterMode,
} from "@getpaseo/protocol/jev-router";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import {
  OPERATIONAL_OFF,
  openJevRouterForm,
  type JevPickSlot,
  type JevRouterFormModel,
  type JevThresholdField,
} from "./form-model";

// CUSTOM(jev-router): the router's sheet, opened from the composer icon: on/off, the mode, and the
// selected mode's models, efforts and thresholds. Mounted fresh per open; the form model owns
// every value (docs/forms.md). Saving writes the host's plugin settings, the same document the
// Settings > Plugins > jev-router screen edits.

const rpc = settingsRpc(JEV_ROUTER_SETTINGS_ID);

const MODE_OPTIONS: SegmentedControlOption<JevRouterMode>[] = [
  { value: "model", label: "Model focused", testID: "jev-mode-model" },
  { value: "effort", label: "Effort focused", testID: "jev-mode-effort" },
];

/** The Claude families the effort-focused picks choose from, on their current 5.5 models. */
const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];

const EFFORT_OPTIONS: SegmentedControlOption<string>[] = JEV_ROUTER_EFFORTS.map((effort) => ({
  value: effort,
  label: effort,
}));

function modelOptions(selected: string): SegmentedControlOption<string>[] {
  const ids = CLAUDE_MODELS.includes(selected) ? CLAUDE_MODELS : [...CLAUDE_MODELS, selected];
  return ids.map((id) => ({ value: id, label: formatClaudeModel(id).replace(/ 5\.5$/, "") }));
}

function operationalOptions(selected: string): SegmentedControlOption<string>[] {
  return [
    { value: OPERATIONAL_OFF, label: "Off", testID: "jev-operational-off" },
    ...modelOptions(selected),
  ];
}

/** One form per sheet mount, loaded from the host's plugin settings. */
export function useJevRouterFormModel(plugin: InstalledPlugin): JevRouterFormModel {
  const [form] = useState(openJevRouterForm);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = rpc.read.output.parse(await plugin.invoke(rpc.read.name, {}));
        if (cancelled) return;
        if (result.status !== "ready") {
          form.applyLoadError(result.error);
          return;
        }
        form.applyLoaded(JevRouterSettingsSchema.parse(result.values), result.revision);
      } catch (error) {
        if (!cancelled)
          form.applyLoadError(`Could not reach the jev-router plugin: ${toErrorMessage(error)}`);
      }
    }
    void load();
    return () => {
      cancelled = true;
      form.close();
    };
  }, [form, plugin]);
  return form;
}

export function JevRouterSheet({
  plugin,
  onClose,
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
}) {
  const form = useJevRouterFormModel(plugin);
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const { draft } = state;
  const header = useMemo<SheetHeader>(() => ({ title: "Jev router" }), []);
  const handleSavePress = useJevRouterSave(form, plugin, onClose);

  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID="jev-router-settings">
      {state.load.status === "loading" ? (
        <View style={styles.loading}>
          <LoadingSpinner size="large" color={styles.spinnerColor.color} />
        </View>
      ) : null}
      {state.load.status === "error" ? (
        <Text style={styles.errorText}>{state.load.message}</Text>
      ) : null}
      {state.load.status === "ready" ? (
        <View style={styles.body}>
          <Text style={styles.intro}>
            Before a new Claude session starts, TypeSafe Jev reads its first prompt and picks the
            model and effort it starts on.
          </Text>
          <Row title="Route new sessions">
            <Switch
              value={draft.enabled}
              onValueChange={form.setEnabled}
              accessibilityLabel="Route new sessions"
              testID="jev-enabled"
            />
          </Row>
          <SegmentedControl
            options={MODE_OPTIONS}
            value={draft.mode}
            onValueChange={form.setMode}
            size="sm"
            testID="jev-mode"
          />
          {draft.mode === "model" ? (
            <ModelFocusedFields form={form} />
          ) : (
            <EffortFocusedFields form={form} />
          )}
          <UpgradeEffortFields form={form} />
          <View style={styles.resetRow}>
            <Button
              variant="ghost"
              size="sm"
              onPress={form.resetMode}
              disabled={state.saving}
              testID="jev-reset-mode"
            >
              Restore this mode’s defaults
            </Button>
          </View>
          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
          <View style={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              onPress={onClose}
              disabled={state.saving}
              testID="jev-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              style={styles.actionButton}
              onPress={handleSavePress}
              disabled={!state.canSave}
              testID="jev-save"
            >
              {state.saving ? "Saving…" : "Save"}
            </Button>
          </View>
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

/** Writes the draft to the host's plugin settings and closes the sheet; returns the Save handler. */
export function useJevRouterSave(
  form: JevRouterFormModel,
  plugin: InstalledPlugin,
  onClose: () => void,
): () => void {
  const handleSave = useCallback(async () => {
    const current = form.getState();
    if (!current.revision) return;
    form.beginSave();
    try {
      const result = rpc.write.output.parse(
        await plugin.invoke(rpc.write.name, { revision: current.revision, values: current.draft }),
      );
      if (result.status !== "saved") throw new Error(result.error);
      // Same key as the composer icon and the settings screen: both see the save at once.
      plugin.queryClient.setQueryData(pluginSettingsKey(JEV_ROUTER_SETTINGS_ID), {
        ...result,
        status: "ready",
      });
      form.saveSucceeded(result.revision);
      onClose();
    } catch (error) {
      form.saveFailed(toErrorMessage(error));
    }
  }, [form, onClose, plugin]);
  return useCallback(() => void handleSave(), [handleSave]);
}

function ModelFocusedFields({ form }: { form: JevRouterFormModel }) {
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  return (
    <View style={styles.section}>
      <Text style={styles.hint}>
        Keeps the model you select and only moves down: chat goes to Haiku low and a tiny task to
        Haiku. Anything else, and every Haiku selection, starts as selected.
      </Text>
      <Row
        title="Use Sonnet for small tasks"
        hint="On: a small task (not tiny) starts on Sonnet instead of your model."
      >
        <Switch
          value={state.draft.modelFocused.useSonnet}
          onValueChange={form.setUseSonnet}
          accessibilityLabel="Use Sonnet for small tasks"
          testID="jev-use-sonnet"
        />
      </Row>
      <ThresholdRow
        form={form}
        field="model.small"
        title="Small task"
        hint="Jev's certainty that the work is small and the reasoning routine."
      />
      <ThresholdRow
        form={form}
        field="model.hard"
        title="Hard signal limit"
        hint="An unknown-cause bug, design choice or risk at or above this keeps your model."
      />
    </View>
  );
}

function EffortFocusedFields({ form }: { form: JevRouterFormModel }) {
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const config = state.draft.effortFocused;
  const setOperationalModel = useCallback(
    (model: string) => form.setOperationalModel(model),
    [form],
  );
  return (
    <View style={styles.section}>
      <Text style={styles.hint}>
        Two models, the effort does the rest. Each first prompt lands in a bucket and starts on its
        model and effort, whatever you selected.
      </Text>
      <View style={styles.bucket}>
        <Text style={styles.label}>Operational</Text>
        <Text style={styles.hint}>
          {config.operationalEnabled
            ? "Chat and tiny tasks: searching code, an easy merge, an HTML page. Starts on Jev’s effort, moved to the nearest checked one (chat on the lowest)."
            : "Off: chat and tiny tasks start on Default, like every other task that isn’t hard."}
        </Text>
        <SegmentedControl
          options={operationalOptions(config.operationalModel)}
          value={config.operationalEnabled ? config.operationalModel : OPERATIONAL_OFF}
          onValueChange={setOperationalModel}
          size="sm"
          testID="jev-operational-model"
        />
        {config.operationalEnabled ? (
          <View style={styles.effortChips}>
            {JEV_ROUTER_EFFORTS.map((effort) => (
              <EffortChip
                key={effort}
                effort={effort}
                checked={config.operationalEfforts.includes(effort)}
                onToggle={form.toggleOperationalEffort}
              />
            ))}
          </View>
        ) : null}
        {config.operationalEnabled && config.operationalEfforts.length === 0 ? (
          <Text style={styles.errorText}>Check at least one effort.</Text>
        ) : null}
      </View>
      <PickFields
        form={form}
        slot="defaultPick"
        title="Default"
        hint="Every task that is neither operational nor hard."
      />
      <PickFields
        form={form}
        slot="hardPick"
        title="Hard"
        hint="Hard reasoning, an unknown-cause bug, a design choice or a risky change."
      />
      <ThresholdRow
        form={form}
        field="effort.small"
        title="Operational task"
        hint="Jev's certainty that the work is tiny and the reasoning routine."
      />
      <ThresholdRow
        form={form}
        field="effort.hard"
        title="Operational hard limit"
        hint="A hard signal at or above this keeps a task out of Operational."
      />
      <ThresholdRow
        form={form}
        field="effort.deep"
        title="Hard task"
        hint="Jev's certainty of hard reasoning, or a hard signal, that picks Hard."
      />
      <Row
        title="Lock models/effort fast cycling"
        hint="← and → in the composer only move between the models and efforts above."
      >
        <Switch
          value={config.lockCycling}
          onValueChange={form.setLockCycling}
          accessibilityLabel="Lock models/effort fast cycling"
          testID="jev-lock-cycling"
        />
      </Row>
    </View>
  );
}

function PickFields({
  form,
  slot,
  title,
  hint,
}: {
  form: JevRouterFormModel;
  slot: JevPickSlot;
  title: string;
  hint: string;
}) {
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const pick = state.draft.effortFocused[slot];
  const setModel = useCallback((model: string) => form.setPickModel(slot, model), [form, slot]);
  const setEffort = useCallback((effort: string) => form.setPickEffort(slot, effort), [form, slot]);
  return (
    <View style={styles.bucket}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <View style={styles.pickRow}>
        <SegmentedControl
          options={modelOptions(pick.model)}
          value={pick.model}
          onValueChange={setModel}
          size="sm"
          testID={`jev-${slot}-model`}
        />
        <SegmentedControl
          options={EFFORT_OPTIONS}
          value={pick.effort}
          onValueChange={setEffort}
          size="sm"
          testID={`jev-${slot}-effort`}
        />
      </View>
    </View>
  );
}

// CUSTOM(jev-router): "Upgrade effort mid-session", in both modes. Restoring a mode's defaults
// leaves it alone.
function UpgradeEffortFields({ form }: { form: JevRouterFormModel }) {
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const setting = state.draft.upgradeEffort;
  return (
    <View style={styles.section}>
      <Row
        title="Upgrade effort mid-session"
        hint="Before a follow-up to an idle Claude session, Jev reads it; if it is hard, the effort goes up to the checked level (never down, same model, so the cache stays on 5.5 models)."
      >
        <Switch
          value={setting.enabled}
          onValueChange={form.setUpgradeEnabled}
          accessibilityLabel="Upgrade effort mid-session"
          testID="jev-upgrade-enabled"
        />
      </Row>
      {setting.enabled ? (
        <View style={styles.effortChips}>
          {JEV_UPGRADE_EFFORTS.map((effort) => (
            <EffortChip
              key={effort}
              effort={effort}
              checked={setting.efforts.includes(effort)}
              onToggle={form.toggleUpgradeEffort}
              testIdPrefix="jev-upgrade-effort"
            />
          ))}
        </View>
      ) : null}
      {setting.enabled && setting.efforts.length === 0 ? (
        <Text style={styles.errorText}>Check at least one effort.</Text>
      ) : null}
    </View>
  );
}

function EffortChip({
  effort,
  checked,
  onToggle,
  testIdPrefix = "jev-operational-effort",
}: {
  effort: string;
  checked: boolean;
  onToggle: (effort: string) => void;
  testIdPrefix?: string;
}) {
  const handlePress = useCallback(() => onToggle(effort), [effort, onToggle]);
  return (
    <Button
      variant={checked ? "default" : "outline"}
      size="sm"
      onPress={handlePress}
      accessibilityLabel={`${effort}${checked ? ", checked" : ""}`}
      testID={`${testIdPrefix}-${effort}`}
    >
      {effort}
    </Button>
  );
}

function ThresholdRow({
  form,
  field,
  title,
  hint,
}: {
  form: JevRouterFormModel;
  field: JevThresholdField;
  title: string;
  hint: string;
}) {
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const handleChange = useCallback(
    (text: string) => form.setThresholdText(field, text),
    [field, form],
  );
  const error = state.thresholdErrors[field];
  return (
    <>
      <Row title={title} hint={hint}>
        <FormTextInput
          key={state.textsVersion}
          size="sm"
          initialValue={state.thresholdTexts[field]}
          onChangeText={handleChange}
          keyboardType="decimal-pad"
          inputMode="decimal"
          selectTextOnFocus
          editable={!state.saving}
          style={styles.thresholdInput}
          accessibilityLabel={title}
          testID={`jev-threshold-${field}`}
        />
      </Row>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Text style={styles.label}>{title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  intro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  section: {
    gap: theme.spacing[3],
  },
  bucket: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  effortChips: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rowContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  thresholdInput: {
    width: 72,
    textAlign: "right",
  },
  resetRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
