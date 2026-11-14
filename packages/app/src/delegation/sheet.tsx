import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsRpc } from "@getpaseo/plugin";
import {
  DELEGATION_CACHE_TTLS,
  DELEGATION_EFFORTS,
  DELEGATION_MODELS,
  DELEGATION_RUNNERS,
  DELEGATION_SEARCH,
  DELEGATION_SETTINGS_ID,
  DELEGATION_WHEN,
  DELEGATION_WHEN_LABELS,
  DelegationSettingsSchema,
  formatDelegationModel,
  type DelegationCacheTtl,
  type DelegationEffort,
  type DelegationModel,
  type DelegationRunner,
  type DelegationSearch,
  type DelegationSettings,
  type DelegationSubagentContext,
  type DelegationWhen,
} from "@getpaseo/protocol/delegation";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { openDelegationForm, type DelegationFormModel } from "./form-model";
import {
  offeredThinkingIds,
  paseoModelOptions,
  paseoProviderOptions,
  paseoThinkingOptions,
} from "./paseo-catalog";
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

const RUNNER_OPTIONS: SegmentedControlOption<DelegationRunner>[] = DELEGATION_RUNNERS.map(
  (runner) => ({
    value: runner,
    label: runner === "claude" ? "Claude subagent" : "Paseo subagent",
  }),
);

const RUNNER_HINTS: Record<DelegationRunner, string> = {
  claude:
    "Claude Code's Agent tool runs a lean paseo-implementer inside the session: about 5k tokens of context, no skills or MCP tools. It appears read-only in the subagents track.",
  paseo:
    "A full Paseo agent you can open, message and keep. It carries the whole Claude Code context (skills, MCP tools, about 35k tokens), trimmed by the Subagents tab.",
};

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

const CACHE_TTL_OPTIONS: SegmentedControlOption<DelegationCacheTtl>[] = DELEGATION_CACHE_TTLS.map(
  (ttl) => ({ value: ttl, label: ttl === "5m" ? "5 minutes" : "1 hour" }),
);

const CACHE_TTL_HINTS: Record<DelegationCacheTtl, string> = {
  "5m": "Cheaper cache writes; the cache expires after 5 idle minutes. Applies to every Claude subagent, Paseo or Claude Code's own.",
  "1h": "Cache writes cost more; the cache survives breaks up to an hour.",
};

/** Provider, Model and Thinking of the Paseo subagent, from the host's provider catalog. */
function PaseoSubagentSelects({
  serverId,
  form,
  draft,
  disabled,
}: {
  serverId: string;
  form: DelegationFormModel;
  draft: DelegationSettings;
  disabled: boolean;
}) {
  const { entries, isLoading, error } = useProvidersSnapshot(serverId, { cwd: null });
  const catalog = useMemo(() => entries ?? [], [entries]);
  const { paseoProvider, paseoModel, paseoThinkingOptionId } = draft;
  const providerOptions = useMemo(
    () => paseoProviderOptions(catalog, paseoProvider),
    [catalog, paseoProvider],
  );
  const modelOptions = useMemo(
    () => paseoModelOptions(catalog, paseoProvider, paseoModel),
    [catalog, paseoProvider, paseoModel],
  );
  const thinkingOptions = useMemo(
    () => paseoThinkingOptions(catalog, paseoProvider, paseoModel, paseoThinkingOptionId),
    [catalog, paseoProvider, paseoModel, paseoThinkingOptionId],
  );
  const setProvider = useCallback((value: string) => form.setPaseoProvider(value), [form]);
  const setModel = useCallback(
    (value: string) => form.setPaseoModel(value, offeredThinkingIds(catalog, paseoProvider, value)),
    [catalog, form, paseoProvider],
  );
  const setThinking = useCallback(
    (value: string) => form.set("paseoThinkingOptionId", value),
    [form],
  );
  const catalogError =
    !isLoading && !entries && error
      ? `Could not load this host's providers and models (${error}). Showing the saved values.`
      : null;
  const unavailable = disabled || (!entries && isLoading);
  return (
    <>
      <SettingsSelect
        label="Provider"
        hint={isLoading && !entries ? "Loading providers…" : undefined}
        error={catalogError}
        options={providerOptions}
        value={paseoProvider}
        onValueChange={setProvider}
        disabled={unavailable}
        testID="delegation-paseo-provider"
      />
      <SettingsSelect
        label="Model"
        options={modelOptions}
        value={paseoModel}
        onValueChange={setModel}
        disabled={unavailable}
        testID="delegation-paseo-model"
      />
      <SettingsSelect
        label="Thinking"
        options={thinkingOptions}
        value={paseoThinkingOptionId}
        onValueChange={setThinking}
        disabled={unavailable}
        testID="delegation-paseo-thinking"
      />
    </>
  );
}

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
  const setRunner = useCallback(
    (value: DelegationRunner) => form.set("implementerRunner", value),
    [form],
  );
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
  const setCacheTtl = useCallback(
    (value: DelegationCacheTtl) => form.set("subagentCacheTtl", value),
    [form],
  );
  const setSubagentInstructions = useCallback(
    (text: string) => form.set("subagentInstructions", text),
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
                    label="Runs as"
                    hint={RUNNER_HINTS[draft.implementerRunner]}
                    options={RUNNER_OPTIONS}
                    value={draft.implementerRunner}
                    onValueChange={setRunner}
                    testID="delegation-runner"
                  />
                  {draft.implementerRunner === "claude" ? (
                    <>
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
                    </>
                  ) : (
                    <PaseoSubagentSelects
                      serverId={plugin.serverId}
                      form={form}
                      draft={draft}
                      disabled={state.saving}
                    />
                  )}
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
                    hint="The session reads the diff, reruns the checks and sends fixes back to the same subagent."
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
                    hint="Off leaves search to the session. A model sends broad searches to a lean read-only search subagent (paseo-search) on it."
                    options={SEARCH_OPTIONS}
                    value={draft.searchModel}
                    onValueChange={setSearch}
                    testID="delegation-search"
                  />
                </SettingsCard>
              </SettingsSection>
              <SettingsSection title="Orchestrator's extra instructions">
                <SettingsCard>
                  <SettingsRow
                    label="Instructions"
                    hint="Added to the end of the delegating session's rule, as written. Applies to new sessions."
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
                      accessibilityLabel="Orchestrator's extra instructions"
                      testID="delegation-extra"
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>
            </>
          ) : null}
          {tab === "subagents" ? (
            <>
              <SettingsSection
                title="Subagent context"
                info="Context applies on each launch to every Paseo subagent (any provider, delegated ones included) and to paseo-implementer when it runs as a Claude subagent (in Project mode it reads the CLAUDE.md and AGENTS.md at the repo root itself). The cache applies to every Claude subagent, Paseo or Claude Code's own."
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
                  <SettingsSelect
                    label="Subagent cache"
                    hint={CACHE_TTL_HINTS[draft.subagentCacheTtl]}
                    options={CACHE_TTL_OPTIONS}
                    value={draft.subagentCacheTtl}
                    onValueChange={setCacheTtl}
                    testID="delegation-subagent-cache"
                  />
                </SettingsCard>
              </SettingsSection>
              <SettingsSection
                title="Additional instructions"
                info="Added to every subagent's instructions. Paseo subagents (any provider that supports an appended system prompt) get it in their system prompt on their next launch. Claude subagents get it appended to each Agent tool prompt by the delegating session, in new sessions."
              >
                <SettingsCard>
                  <SettingsRow
                    label="Instructions"
                    hint="Paseo subagents get this text in their system prompt. New delegating Claude sessions also put it at the end of every Agent tool prompt."
                    error={state.subagentInstructionsError}
                  >
                    <FormTextInput
                      key={state.textsVersion}
                      multiline
                      initialValue={draft.subagentInstructions}
                      onChangeText={setSubagentInstructions}
                      placeholder="Added to every subagent's instructions. Example: End with a short report: files changed, commands run, results."
                      editable={!state.saving}
                      style={styles.extraInput}
                      accessibilityLabel="Additional subagent instructions"
                      testID="delegation-subagent-instructions"
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>
            </>
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
