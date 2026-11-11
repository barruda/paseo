import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  DEFAULT_JEV_MODEL,
  DEFAULT_TYPESAFE_API_URL,
  type JevRouteOutput,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";
import { routeRpc, routerSettings } from "../shared/settings";

type ReadySettings = Extract<SettingsState<typeof routerSettings.schema>, { status: "ready" }>;

const TIMEOUTS = [
  { label: "1 s", value: "1" },
  { label: "2 s (measured default)", value: "2" },
  { label: "3 s", value: "3" },
  { label: "5 s", value: "5" },
];

const TEST_PROMPT = "Rename the variable `count` to `total` in utils.ts";

function describeTest(output: JevRouteOutput): string {
  if (output.status === "skipped") return `Skipped: ${output.reason}`;
  const { decision } = output;
  if (decision.error) return `Router failed (session keeps ${output.home}): ${decision.error}`;
  const pick = `${decision.model}/${decision.effort} (${decision.why})`;
  const latency = decision.latencyMs === null ? "" : `, Jev ${decision.latencyMs} ms`;
  return `"${TEST_PROMPT}" from ${output.home} → ${pick}${latency}`;
}

function TextFields({ settings }: { settings: ReadySettings }) {
  // Text drafts live here until Save, with the revision they started from.
  const [draft, setDraft] = useState(() => ({
    values: settings.values,
    revision: settings.revision,
  }));
  const set = useCallback(
    (key: "apiKey" | "apiUrl" | "jevModel" | "routerScript" | "python") => (text: string) =>
      setDraft((current) => ({ ...current, values: { ...current.values, [key]: text } })),
    [],
  );
  const save = useCallback(async () => {
    const values: JevRouterSettings = {
      ...settings.values,
      apiKey: draft.values.apiKey,
      apiUrl: draft.values.apiUrl,
      jevModel: draft.values.jevModel,
      routerScript: draft.values.routerScript,
      python: draft.values.python,
    };
    if (await settings.save(values, settings.revision))
      setDraft({ values, revision: settings.revision });
  }, [settings, draft]);
  return (
    <SettingsCard>
      <SettingsInput
        label="TypeSafe API key"
        hint="Empty: route.py reads TYPESAFE_API_KEY or ~/.config/typesafe/env. Stored as plain JSON in this host's plugin settings."
        initialValue={draft.values.apiKey}
        placeholder="TypeSafe key"
        secureTextEntry
        onChangeText={set("apiKey")}
        disabled={settings.saving}
      />
      <SettingsInput
        label="TypeSafe endpoint"
        hint="Another account or gateway for this host. Empty: TYPESAFE_API_URL or the public API."
        initialValue={draft.values.apiUrl}
        placeholder={DEFAULT_TYPESAFE_API_URL}
        onChangeText={set("apiUrl")}
        disabled={settings.saving}
      />
      <SettingsInput
        label="Jev model"
        hint="Empty: the model the thresholds were measured on"
        initialValue={draft.values.jevModel}
        placeholder={DEFAULT_JEV_MODEL}
        onChangeText={set("jevModel")}
        disabled={settings.saving}
      />
      <SettingsInput
        label="Router script"
        hint="gnome-custom's jev-router/route.py"
        initialValue={draft.values.routerScript}
        onChangeText={set("routerScript")}
        disabled={settings.saving}
      />
      <SettingsInput
        label="Python"
        hint="3.10+, standard library only"
        initialValue={draft.values.python}
        onChangeText={set("python")}
        disabled={settings.saving}
      />
      <SettingsAction
        label="Provider and paths"
        actionLabel="Save"
        onPress={save}
        disabled={settings.saving}
        error={settings.saveError}
      />
    </SettingsCard>
  );
}

function RouterControls({ settings, theme }: { settings: ReadySettings } & PluginSurfaceProps) {
  const route = useRpc(routeRpc);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const textStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const patch = useCallback(
    (values: Partial<JevRouterSettings>) =>
      void settings.save({ ...settings.values, ...values }, settings.revision),
    [settings],
  );
  const test = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const output = await route({
        prompt: TEST_PROMPT,
        cwd: "/tmp",
        images: 0,
        provider: "claude",
        model: "claude-opus-5-5",
        thinkingOptionId: "high",
        test: true,
      });
      setTestResult(describeTest(output));
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  }, [route]);
  const setEnabled = useCallback((enabled: boolean) => patch({ enabled }), [patch]);
  const setTimeoutSeconds = useCallback(
    (value: string) => patch({ timeoutSeconds: Number(value) }),
    [patch],
  );
  const setLogDecisions = useCallback((logDecisions: boolean) => patch({ logDecisions }), [patch]);
  const { values } = settings;
  return (
    <>
      <SettingsSection
        title="Jev router"
        info="Before a new Claude session starts from a draft's first message, TypeSafe Jev reads the prompt. When it is sure the task is small and plain, the session starts on Sonnet or Haiku instead of the model you selected. It never picks a stronger model. Follow-ups, automations and other providers are not routed."
      >
        <SettingsCard>
          <SettingsSwitch
            label="Route new sessions"
            hint="The route icon in the composer, after the critic's, turns this on and off too. A routed session gets a card in the chat with a button to start over on the model you picked."
            value={values.enabled}
            onValueChange={setEnabled}
            disabled={settings.saving}
          />
          <SettingsSelect
            label="Jev timeout"
            hint="Past it the session starts as selected"
            value={String(values.timeoutSeconds)}
            options={TIMEOUTS}
            onValueChange={setTimeoutSeconds}
            disabled={settings.saving}
          />
          <SettingsSwitch
            label="Log decisions"
            hint="~/.local/state/jev-router/decisions.jsonl; review with `route.py review --days 7`"
            value={values.logDecisions}
            onValueChange={setLogDecisions}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="TypeSafe and router">
        <TextFields key={settings.revision} settings={settings} />
        <SettingsCard>
          <SettingsAction
            label="Test"
            hint="Routes a sample prompt from opus/high, without logging"
            actionLabel={testing ? "Testing…" : "Run"}
            onPress={test}
            disabled={testing}
          />
          {testResult ? (
            <SettingsRow label="Result">
              <Text selectable style={textStyle}>
                {testResult}
              </Text>
            </SettingsRow>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

export function JevRouterSettingsScreen(props: PluginSurfaceProps) {
  const settings = useSettings(routerSettings);
  const style = useMemo(() => ({ color: props.theme.colors.foreground }), [props.theme]);
  if (settings.status === "loading") return <Text style={style}>Loading settings…</Text>;
  if (settings.status !== "ready")
    return (
      <SettingsSection title="Jev router">
        <Text style={style}>{settings.error}</Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Restore defaults" actionLabel="Reset" onPress={settings.reset} />
        ) : null}
      </SettingsSection>
    );
  return <RouterControls settings={settings} {...props} />;
}
