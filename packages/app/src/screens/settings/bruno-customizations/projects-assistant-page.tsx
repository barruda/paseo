// CUSTOM(projects-assistant): Settings > Bruno's Customizations > Project Manager. What the
// assistant does with a task's work when its agent finishes, per project. The settings live in the
// Workboard plugin on the host; this page reads and writes them through its RPCs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { SettingsTextArea } from "@/components/settings-textarea";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { settingsStyles } from "@/styles/settings";
import { toErrorMessage } from "@/utils/error-messages";
import {
  ACTION_LABELS,
  ASSISTANT_ACTIONS,
  ASSISTANT_DEFAULT_ACTIONS,
  DEFAULT_COMPACT_AT_TOKENS,
  DEFAULT_WAKE_DELAY_SECONDS,
  FACTORY_MODE_LABELS,
  GATE_RUN_IN,
  GATE_RUN_IN_LABELS,
  MAX_AUTO_FIXES,
  REVIEW_LABELS,
  REVIEW_POLICIES,
  actionNeedsGit,
  assistantSettingsResponseSchema,
  chatSettingsValid,
  factoryModeOptions,
  patchChatSettings,
  patchFactorySettings,
  patchProjectPolicy,
  patchProjectTests,
  formatEnv,
  parseEnv,
  parseList,
  policyActs,
  projectReview,
  resetProjectPolicy,
  setProjectAction,
  setProjectReview,
  settingsEqual,
  type AssistantAction,
  type AssistantDefaultAction,
  type AssistantProject,
  type AssistantSettings,
  type AssistantSettingsResponse,
  type FactoryMode,
  type ReviewPolicy,
} from "./projects-assistant-model";

const PLUGIN_ID = "power-workboard";
const GET_METHOD = "workboard.assistant.settings.get";
const SET_METHOD = "workboard.assistant.settings.set";

const DEFAULT_OPTIONS = ASSISTANT_DEFAULT_ACTIONS.map((value) => ({
  value,
  label: ACTION_LABELS[value],
}));
const REVIEW_OPTIONS = REVIEW_POLICIES.map((value) => ({
  value,
  label: REVIEW_LABELS[value],
}));
const AUTO_FIX_OPTIONS = Array.from({ length: MAX_AUTO_FIXES + 1 }, (_, index) => ({
  value: String(index),
  label: String(index),
}));

export function BrunoProjectsAssistantPage({ serverId }: { serverId: string | null }) {
  if (!serverId) {
    return (
      <Text style={settingsStyles.rowHint}>Connect a host to set up the Project Manager.</Text>
    );
  }
  return <ProjectsAssistantSettings serverId={serverId} />;
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; saved: AssistantSettingsResponse };

function ProjectsAssistantSettings({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, PLUGIN_ID);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<AssistantSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const draftRef = useRef<AssistantSettings | null>(null);
  draftRef.current = draft;

  const reload = useCallback(async () => {
    if (!plugin) return;
    setLoad({ status: "loading" });
    try {
      const saved = assistantSettingsResponseSchema.parse(await plugin.invoke(GET_METHOD, {}));
      setLoad({ status: "ready", saved });
      setDraft(saved.settings);
    } catch (error) {
      setLoad({ status: "error", message: toErrorMessage(error) });
    }
  }, [plugin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleReload = useCallback(() => void reload(), [reload]);

  const handleSave = useCallback(async () => {
    const settings = draftRef.current;
    if (!plugin || !settings) return;
    setSaving(true);
    setFailure(null);
    try {
      const saved = assistantSettingsResponseSchema.parse(
        await plugin.invoke(SET_METHOD, { settings }),
      );
      setLoad({ status: "ready", saved });
      setDraft(saved.settings);
    } catch (error) {
      setFailure(toErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [plugin]);
  const handleSavePress = useCallback(() => void handleSave(), [handleSave]);

  const handleEnabled = useCallback(
    (enabled: boolean) => setDraft((current) => (current ? { ...current, enabled } : current)),
    [],
  );
  const handleDefaultAction = useCallback(
    (defaultAction: AssistantDefaultAction) =>
      setDraft((current) => (current ? { ...current, defaultAction } : current)),
    [],
  );
  const handleChat = useCallback(
    (patch: Parameters<typeof patchChatSettings>[1]) =>
      setDraft((current) => (current ? patchChatSettings(current, patch) : current)),
    [],
  );
  const handleModel = useCallback((provider: string) => handleChat({ provider }), [handleChat]);
  const handleThinking = useCallback(
    (thinkingOptionId: string) => handleChat({ thinkingOptionId }),
    [handleChat],
  );
  const handleMode = useCallback((modeId: string) => handleChat({ modeId }), [handleChat]);
  // CUSTOM(assistant-compact)
  const handleCompactAt = useCallback(
    (compactAtTokens: string) => handleChat({ compactAtTokens }),
    [handleChat],
  );
  // CUSTOM(assistant-wake)
  const handleWakeDelay = useCallback(
    (wakeDelaySeconds: string) => handleChat({ wakeDelaySeconds }),
    [handleChat],
  );
  // CUSTOM(factory)
  const handleFactoryMode = useCallback(
    (mode: FactoryMode) =>
      setDraft((current) => (current ? patchFactorySettings(current, { mode }) : current)),
    [],
  );
  const handleFactoryRoot = useCallback(
    (root: string) =>
      setDraft((current) => (current ? patchFactorySettings(current, { root }) : current)),
    [],
  );
  const handleProjectChange = useCallback(
    (update: (settings: AssistantSettings) => AssistantSettings) =>
      setDraft((current) => (current ? update(current) : current)),
    [],
  );

  const dirty = useMemo(
    () => load.status === "ready" && draft !== null && !settingsEqual(draft, load.saved.settings),
    [draft, load],
  );

  if (!plugin) {
    return (
      <Text style={settingsStyles.rowHint}>
        The Workboard plugin is not installed on this host, or the host is offline. The Project
        Manager is part of it.
      </Text>
    );
  }

  return (
    <SettingsSection title="Project Manager">
      <Text style={settingsStyles.rowHint}>
        Works in Tasks mode. Decides what happens to a task&apos;s work when its agent finishes.
      </Text>
      {load.status === "loading" ? <Text style={settingsStyles.rowHint}>Loading…</Text> : null}
      {load.status === "error" ? (
        <>
          <Alert variant="error" description={load.message} />
          <View>
            <Button variant="outline" size="sm" onPress={handleReload}>
              Retry
            </Button>
          </View>
        </>
      ) : null}
      {load.status === "ready" && draft ? (
        <>
          <SettingsCard testID="projects-assistant-general">
            <SettingsSwitch
              label="Enabled"
              hint="When off, finished tasks are left where they are."
              value={draft.enabled}
              onValueChange={handleEnabled}
            />
            <SettingsSelect
              label="Default action"
              hint="For projects without a rule of their own. Merge is never a default."
              value={draft.defaultAction}
              options={DEFAULT_OPTIONS}
              onValueChange={handleDefaultAction}
            />
          </SettingsCard>
          <Text style={settingsStyles.sectionHeaderTitle}>Chat</Text>
          <SettingsCard testID="projects-assistant-chat">
            <SettingsInput
              label="Model"
              hint="Used for new conversations. Its board tools need Agents > Enable Paseo tools on this host."
              initialValue={draft.chat.provider}
              onChangeText={handleModel}
              placeholder="claude/claude-opus-5-5"
            />
            <SettingsInput
              label="Thinking"
              hint="Empty uses the provider's default."
              initialValue={draft.chat.thinkingOptionId ?? ""}
              onChangeText={handleThinking}
              placeholder="high"
            />
            <SettingsInput
              label="Mode"
              hint="It only uses the board's tools, in an empty folder"
              initialValue={draft.chat.modeId ?? ""}
              onChangeText={handleMode}
              placeholder="bypassPermissions"
            />
            <SettingsInput
              label="Compact at (tokens)"
              hint="When a turn leaves the chat's context at this size or more, the board starts a new chat with a short summary and archives the old one. 0 turns it off."
              initialValue={String(draft.chat.compactAtTokens)}
              onChangeText={handleCompactAt}
              placeholder={String(DEFAULT_COMPACT_AT_TOKENS)}
            />
            <SettingsInput
              label="Wake delay (s)"
              hint="How long tasks that need you are batched before the board tells the Project Manager. A busy chat retries every 10 s."
              initialValue={String(draft.chat.wakeDelaySeconds)}
              onChangeText={handleWakeDelay}
              placeholder={String(DEFAULT_WAKE_DELAY_SECONDS)}
            />
          </SettingsCard>
          <Text style={settingsStyles.sectionHeaderTitle}>Factory</Text>
          <SettingsCard testID="projects-assistant-factory">
            <SettingsSelect
              label="Mode"
              hint="Shadow loads the factory folder on every change and compares it with the board's settings; the board shows the errors and differences and keeps using its own settings."
              value={draft.factory.mode}
              options={factoryModeOptions(draft.factory.mode).map((value) => ({
                value,
                label: FACTORY_MODE_LABELS[value],
              }))}
              onValueChange={handleFactoryMode}
            />
            <SettingsInput
              label="Folder"
              hint="A git repository of YAML and Markdown files. Empty uses ~/.paseo/factory; ~/ is your home."
              initialValue={draft.factory.root}
              onChangeText={handleFactoryRoot}
              placeholder="~/.paseo/factory"
            />
          </SettingsCard>
          <Text style={settingsStyles.sectionHeaderTitle}>Per project</Text>
          {load.saved.projects.length === 0 ? (
            <Text style={settingsStyles.rowHint}>This host has no projects yet.</Text>
          ) : (
            load.saved.projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                settings={draft}
                onChange={handleProjectChange}
              />
            ))
          )}
          {failure ? <Alert variant="error" description={failure} /> : null}
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent} />
            <Button
              variant="default"
              size="sm"
              onPress={handleSavePress}
              disabled={saving || !dirty || !chatSettingsValid(draft)}
              testID="projects-assistant-save"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </View>
        </>
      ) : null}
    </SettingsSection>
  );
}

function ProjectCard({
  project,
  settings,
  onChange,
}: {
  project: AssistantProject;
  settings: AssistantSettings;
  onChange: (update: (settings: AssistantSettings) => AssistantSettings) => void;
}) {
  const policy = settings.projects[project.id];
  const options = useMemo(
    () =>
      ASSISTANT_ACTIONS.map((value) => ({
        value,
        label: ACTION_LABELS[value],
        disabled: !project.isGit && actionNeedsGit(value),
      })).filter((option) => !option.disabled),
    [project.isGit],
  );
  const value: AssistantAction | "default" = policy ? policy.action : "default";
  const handleAction = useCallback(
    (action: AssistantAction) =>
      onChange((current) => setProjectAction(current, project.id, action)),
    [onChange, project.id],
  );
  const handleReset = useCallback(
    () => onChange((current) => resetProjectPolicy(current, project.id)),
    [onChange, project.id],
  );
  const handleReview = useCallback(
    (review: ReviewPolicy) => onChange((current) => setProjectReview(current, project.id, review)),
    [onChange, project.id],
  );
  const handleObserve = useCallback(
    (observe: boolean) =>
      onChange((current) => patchProjectPolicy(current, project.id, { observe })),
    [onChange, project.id],
  );
  const handleCheck = useCallback(
    (verifyCommand: string) =>
      onChange((current) => patchProjectPolicy(current, project.id, { verifyCommand })),
    [onChange, project.id],
  );
  const handleFixes = useCallback(
    (autoFixes: string) =>
      onChange((current) =>
        patchProjectPolicy(current, project.id, {
          autoFixes: Number(autoFixes),
        }),
      ),
    [onChange, project.id],
  );
  const handleBase = useCallback(
    (baseBranch: string) =>
      onChange((current) => patchProjectPolicy(current, project.id, { baseBranch })),
    [onChange, project.id],
  );
  // CUSTOM(packages): the project's gate and the risk rule, editable here instead of only by the PM.
  const handleGateCommand = useCallback(
    (gateCommand: string) =>
      onChange((current) => patchProjectTests(current, project.id, { gateCommand })),
    [onChange, project.id],
  );
  const handleRequiredEnv = useCallback(
    (text: string) =>
      onChange((current) =>
        patchProjectTests(current, project.id, { gateRequiredEnv: parseList(text) }),
      ),
    [onChange, project.id],
  );
  const handleGateEnv = useCallback(
    (text: string) =>
      onChange((current) => patchProjectTests(current, project.id, { gateEnv: parseEnv(text) })),
    [onChange, project.id],
  );
  const handleRiskPaths = useCallback(
    (text: string) =>
      onChange((current) =>
        patchProjectTests(current, project.id, { gateRiskPaths: parseList(text) }),
      ),
    [onChange, project.id],
  );
  const handleRunIn = useCallback(
    (gateRunIn: (typeof GATE_RUN_IN)[number]) =>
      onChange((current) => patchProjectTests(current, project.id, { gateRunIn })),
    [onChange, project.id],
  );
  const selectOptions = useMemo(
    () =>
      value === "default"
        ? [
            {
              value: "default" as const,
              label: `Default (${ACTION_LABELS[settings.defaultAction]})`,
            },
            ...options.map((option) => ({
              value: option.value,
              label: option.label,
            })),
          ]
        : options.map((option) => ({
            value: option.value,
            label: option.label,
          })),
    [options, settings.defaultAction, value],
  );
  const handleSelect = useCallback(
    (next: AssistantAction | "default") => {
      if (next !== "default") handleAction(next);
    },
    [handleAction],
  );
  return (
    <SettingsCard testID={`projects-assistant-project-${project.id}`}>
      <SettingsSelect
        label={project.name}
        hint={
          project.isGit
            ? project.directory
            : `${project.directory}\nNot a git project: Assistant reviews, Merge and Prepare PR are unavailable.`
        }
        value={value}
        options={selectOptions}
        onValueChange={handleSelect}
      />
      <SettingsSelect
        label="Review"
        hint="Who reviews a finished task before it is merged. A big or risky change still goes to a fresh agent."
        value={projectReview(settings, project.id)}
        options={REVIEW_OPTIONS}
        onValueChange={handleReview}
      />
      {policy ? (
        <SettingsRow label="Rule" hint="This project has its own rule.">
          <Button variant="outline" size="sm" onPress={handleReset}>
            Reset to default
          </Button>
        </SettingsRow>
      ) : null}
      {policyActs(policy) ? (
        <>
          <SettingsSwitch
            label="Observe only"
            hint="Records what it would do, without doing it."
            value={policy.observe}
            onValueChange={handleObserve}
          />
          <SettingsInput
            label="Check command"
            hint="Runs in the task's worktree before merging; empty merges directly"
            initialValue={policy.verifyCommand}
            onChangeText={handleCheck}
            placeholder="npm run typecheck && npm run lint"
          />
          <SettingsSelect
            label="Auto-fix attempts"
            hint={
              policy.verifyCommand.trim()
                ? "How many times a failed check goes back to the same agent before you are told."
                : "Only used with a check command."
            }
            value={String(policy.autoFixes)}
            options={AUTO_FIX_OPTIONS}
            disabled={!policy.verifyCommand.trim()}
            onValueChange={handleFixes}
          />
          <SettingsInput
            label="Base branch"
            initialValue={policy.baseBranch}
            onChangeText={handleBase}
            placeholder="Current branch of the project"
          />
        </>
      ) : null}
      {policy ? (
        <>
          <Text style={settingsStyles.sectionHeaderTitle}>Package gate</Text>
          <SettingsInput
            label="Gate command"
            hint="The full suite a package runs once, by script. Empty uses the check command."
            initialValue={policy.tests.gateCommand}
            onChangeText={handleGateCommand}
            placeholder="npm test"
          />
          <SettingsInput
            label="Required environment"
            hint="Comma or newline separated names. A missing one fails the gate instead of letting suites skip."
            initialValue={policy.tests.gateRequiredEnv.join(", ")}
            onChangeText={handleRequiredEnv}
            placeholder="DATABASE_URL, REDIS_URL"
          />
          <SettingsRow label="Gate environment" hint="NAME=value per line, set for the gate run.">
            <SettingsTextArea
              accessibilityLabel="Gate environment"
              value={formatEnv(policy.tests.gateEnv)}
              onChangeText={handleGateEnv}
              placeholder="TH_SERVER_TEST_REQUIRE_DB=1"
            />
          </SettingsRow>
          <SettingsInput
            label="Risk paths"
            hint="Globs that raise a ticket's diff to the gate level. Comma or newline separated."
            initialValue={policy.tests.gateRiskPaths.join(", ")}
            onChangeText={handleRiskPaths}
            placeholder="**/migrations/**, **/auth/**"
          />
          <SettingsSelect
            label="Gate runs in"
            hint="A dedicated worktree never touches your checkout; the live checkout skips the bisect."
            value={policy.tests.gateRunIn}
            options={GATE_RUN_IN.map((option) => ({
              value: option,
              label: GATE_RUN_IN_LABELS[option],
            }))}
            onValueChange={handleRunIn}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}
