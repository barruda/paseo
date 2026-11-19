// CUSTOM(projects-assistant): Settings > Bruno's Customizations > Projects Assistant. What the
// assistant does with a task's work when its agent finishes, per project. The settings live in the
// Power Workboard plugin on the host; this page reads and writes them through its RPCs.

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
  MAX_AUTO_FIXES,
  REVIEW_LABELS,
  REVIEW_POLICIES,
  actionNeedsGit,
  assistantSettingsResponseSchema,
  chatSettingsValid,
  patchChatSettings,
  patchProjectPolicy,
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
      <Text style={settingsStyles.rowHint}>Connect a host to set up the Projects Assistant.</Text>
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
        The Power Workboard plugin is not installed on this host, or the host is offline. The
        Projects Assistant is part of it.
      </Text>
    );
  }

  return (
    <SettingsSection title="Projects Assistant">
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
    </SettingsCard>
  );
}
