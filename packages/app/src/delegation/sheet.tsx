import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsRpc } from "@getpaseo/plugin";
import {
  DELEGATION_EFFORTS,
  DELEGATION_MODELS,
  DELEGATION_SEARCH,
  DELEGATION_SETTINGS_ID,
  DELEGATION_WHEN,
  DELEGATION_WHEN_LABELS,
  DelegationSettingsSchema,
  formatDelegationModel,
  type DelegationEffort,
  type DelegationModel,
  type DelegationSearch,
  type DelegationSubagentContext,
  type DelegationWhen,
} from "@getpaseo/protocol/delegation";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import {
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import { openDelegationForm, type DelegationFormModel } from "./form-model";
import { DelegationReports } from "./reports";

// CUSTOM(delegation): the delegation sheet, opened from the composer icon's caret and from
// Settings > Bruno's Customizations > Composer. Mounted fresh per open; the form model owns every
// value (docs/forms.md). Saving writes the host's plugin settings, the document the icon reads.

const rpc = settingsRpc(DELEGATION_SETTINGS_ID);

type SheetTab = "delegation" | "subagents" | "reports";

const TAB_OPTIONS: SegmentedControlOption<SheetTab>[] = [
  { value: "delegation", label: "Delegation", testID: "delegation-tab-delegation" },
  { value: "subagents", label: "Subagents", testID: "delegation-tab-subagents" },
  { value: "reports", label: "Reports", testID: "delegation-tab-reports" },
];

const MODEL_OPTIONS: SegmentedControlOption<DelegationModel>[] = DELEGATION_MODELS.map((model) => ({
  value: model,
  label: formatDelegationModel(model),
}));

const EFFORT_OPTIONS: SegmentedControlOption<DelegationEffort>[] = DELEGATION_EFFORTS.map(
  (effort) => ({ value: effort, label: effort }),
);

const WHEN_OPTIONS: SegmentedControlOption<DelegationWhen>[] = DELEGATION_WHEN.map((when) => ({
  value: when,
  label: DELEGATION_WHEN_LABELS[when],
}));

const WHEN_HINTS: Record<DelegationWhen, string> = {
  conservative: "Only after you approve a plan, and only a change to three or more files.",
  balanced: "Any change to more than one file, once the approach is settled.",
  aggressive: "Every code change except a one-edit fix.",
};

const SEARCH_OPTIONS: SegmentedControlOption<DelegationSearch>[] = DELEGATION_SEARCH.map(
  (model) => ({ value: model, label: model === "off" ? "Off" : formatDelegationModel(model) }),
);

const SUBAGENT_CONTEXT_OPTIONS: SegmentedControlOption<DelegationSubagentContext>[] = [
  { value: "full", label: "Full" },
  { value: "project", label: "Project only" },
  { value: "none", label: "None" },
];

const SUBAGENT_CONTEXT_HINTS: Record<DelegationSubagentContext, string> = {
  full: "Loads every CLAUDE.md and AGENTS.md, the same as any session. Your global rules go into each subagent's context.",
  project:
    "Claude: skips your user-level CLAUDE.md and the ones in folders above the repo, and keeps the repo's own, so its safety rules still apply. Codex: no change, it has no setting to skip its global AGENTS.md.",
  none: "Claude: skips every CLAUDE.md, the repo's too. Codex: skips the repo's AGENTS.md, but still reads the global ~/.codex/AGENTS.md. The smallest context, and the repo's safety rules are gone.",
};

/** One form per sheet mount, loaded from the host's plugin settings. */
function useDelegationFormModel(plugin: InstalledPlugin): DelegationFormModel {
  const [form] = useState(openDelegationForm);
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
        form.applyLoaded(DelegationSettingsSchema.parse(result.values), result.revision);
      } catch (error) {
        if (!cancelled)
          form.applyLoadError(`Could not reach the delegation plugin: ${toErrorMessage(error)}`);
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

export function DelegationSheet({
  plugin,
  onClose,
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
}) {
  const form = useDelegationFormModel(plugin);
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const { draft } = state;
  const header = useMemo<SheetHeader>(() => ({ title: "Delegation" }), []);
  const [tab, setTab] = useState<SheetTab>("delegation");
  const handleSavePress = useDelegationSave(form, plugin, onClose);
  const setEnabled = useCallback((value: boolean) => form.set("enabled", value), [form]);
  const setModel = useCallback(
    (value: DelegationModel) => form.set("implementerModel", value),
    [form],
  );
  const setEffort = useCallback(
    (value: DelegationEffort) => form.set("implementerEffort", value),
    [form],
  );
  const setWhen = useCallback((value: DelegationWhen) => form.set("when", value), [form]);
  const setReview = useCallback((value: boolean) => form.set("review", value), [form]);
  const setSearch = useCallback(
    (value: DelegationSearch) => form.set("searchModel", value),
    [form],
  );
  const setExtra = useCallback((text: string) => form.set("extraInstructions", text), [form]);

  const setSubagentContext = useCallback(
    (value: DelegationSubagentContext) => form.set("subagentContext", value),
    [form],
  );
  const isFormTab = tab !== "reports";

  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID="delegation-settings">
      <SegmentedControl
        options={TAB_OPTIONS}
        value={tab}
        onValueChange={setTab}
        size="sm"
        style={styles.tabs}
        testID="delegation-tabs"
      />
      {tab === "reports" ? <DelegationReports plugin={plugin} /> : null}
      {isFormTab && state.load.status === "loading" ? (
        <View style={styles.loading}>
          <LoadingSpinner size="large" color={styles.spinnerColor.color} />
        </View>
      ) : null}
      {isFormTab && state.load.status === "error" ? (
        <Text style={styles.errorText}>{state.load.message}</Text>
      ) : null}
      {isFormTab && state.load.status === "ready" ? (
        <View style={styles.body}>
          {tab === "delegation" ? (
            <>
              <SettingsCard>
                <SettingsRow
                  label="Delegate in new sessions"
                  hint="Opus and Fable sessions plan and review; a cheaper subagent writes the code. Applies to new sessions."
                >
                  <Switch
                    value={draft.enabled}
                    onValueChange={setEnabled}
                    accessibilityLabel="Delegate in new sessions"
                    testID="delegation-enabled"
                  />
                </SettingsRow>
              </SettingsCard>
              <SettingsSection title="Implementer">
                <SettingsCard>
                  <SettingsSelect
                    label="Model"
                    options={MODEL_OPTIONS}
                    value={draft.implementerModel}
                    onValueChange={setModel}
                    testID="delegation-model"
                  />
                  <SettingsSelect
                    label="Effort"
                    options={EFFORT_OPTIONS}
                    value={draft.implementerEffort}
                    onValueChange={setEffort}
                    testID="delegation-effort"
                  />
                </SettingsCard>
              </SettingsSection>
              <SettingsSection title="Policy">
                <SettingsCard>
                  <SettingsSelect
                    label="When to delegate"
                    hint={WHEN_HINTS[draft.when]}
                    options={WHEN_OPTIONS}
                    value={draft.when}
                    onValueChange={setWhen}
                    testID="delegation-when"
                  />
                  <SettingsRow
                    label="Review in the session"
                    hint="It reads the diff, reruns the checks and sends fixes back to the same subagent."
                  >
                    <Switch
                      value={draft.review}
                      onValueChange={setReview}
                      accessibilityLabel="Review in the session"
                      testID="delegation-review"
                    />
                  </SettingsRow>
                  <SettingsSelect
                    label="Broad searches"
                    hint="Off leaves search to the session. A model sends broad searches to an Explore subagent on it."
                    options={SEARCH_OPTIONS}
                    value={draft.searchModel}
                    onValueChange={setSearch}
                    testID="delegation-search"
                  />
                </SettingsCard>
              </SettingsSection>
              <SettingsCard>
                <SettingsCollapsibleRow label="Advanced" testID="delegation-advanced">
                  <SettingsRow
                    label="Extra instructions"
                    hint="Added to the end of the rule, as written."
                    error={state.extraError}
                  >
                    <FormTextInput
                      key={state.textsVersion}
                      multiline
                      initialValue={draft.extraInstructions}
                      onChangeText={setExtra}
                      placeholder="Never delegate Unity scene edits."
                      editable={!state.saving}
                      style={styles.extraInput}
                      accessibilityLabel="Extra instructions"
                      testID="delegation-extra"
                    />
                  </SettingsRow>
                  <SettingsRow label="Restore defaults">
                    <Button
                      variant="outline"
                      onPress={form.resetDefaults}
                      disabled={state.saving}
                      testID="delegation-reset"
                    >
                      Restore
                    </Button>
                  </SettingsRow>
                </SettingsCollapsibleRow>
              </SettingsCard>
            </>
          ) : null}
          {tab === "subagents" ? (
            <SettingsSection
              title="Subagent context"
              info="Applies to Claude and Codex subagents created through Paseo, on their next launch. Subagents that Claude Code starts with its own Agent tool inherit the context of the parent and are not affected."
            >
              <SettingsCard>
                <SettingsSelect
                  label="Context"
                  hint={SUBAGENT_CONTEXT_HINTS[draft.subagentContext]}
                  options={SUBAGENT_CONTEXT_OPTIONS}
                  value={draft.subagentContext}
                  onValueChange={setSubagentContext}
                  testID="delegation-subagent-context"
                />
              </SettingsCard>
            </SettingsSection>
          ) : null}
          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
          <View style={styles.actions}>
            <Button
              variant="secondary"
              style={styles.actionButton}
              onPress={onClose}
              disabled={state.saving}
              testID="delegation-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              style={styles.actionButton}
              onPress={handleSavePress}
              disabled={!state.canSave}
              testID="delegation-save"
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
function useDelegationSave(
  form: DelegationFormModel,
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
      // Same key as the composer icon: it sees the save at once.
      plugin.queryClient.setQueryData(pluginSettingsKey(DELEGATION_SETTINGS_ID), {
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

const styles = StyleSheet.create((theme) => ({
  tabs: {
    marginBottom: theme.spacing[6],
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  body: {
    gap: theme.spacing[6],
    paddingBottom: theme.spacing[2],
  },
  extraInput: {
    minHeight: 64,
    minWidth: 200,
    textAlignVertical: "top",
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
