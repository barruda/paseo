import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PI_MODELS_PLUGIN_ID, type PiModelsTestOutput } from "@getpaseo/protocol/pi-models";
import { SettingsAddRow, SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import { readProviders, type PiModelView, type PiProviderView } from "./document";
import { PiModelSheet, PiProviderSheet, PiRawSheet } from "./sheets";
import { usePiModels, type PiModelsController } from "./use-pi-models";

// CUSTOM(pi-models): the Pi provider page's editor for Pi's own models.json: custom endpoints, their
// key and API, and each model's thinking levels. Paseo lists whatever `pi` lists, so a save refreshes
// the provider and the new models and efforts show up in the pickers. Hidden without the plugin.

export function PiModelsSection({ serverId, onSaved }: { serverId: string; onSaved: () => void }) {
  const plugin = useInstalledPlugin(serverId, PI_MODELS_PLUGIN_ID);
  if (!plugin) return null;
  return <PiModelsEditor plugin={plugin} onSaved={onSaved} />;
}

type OpenSheet =
  | { kind: "provider"; provider: PiProviderView | null }
  | { kind: "model"; provider: PiProviderView; model: PiModelView | null }
  | { kind: "raw" }
  | null;

function PiModelsEditor({ plugin, onSaved }: { plugin: InstalledPlugin; onSaved: () => void }) {
  const controller = usePiModels(plugin, onSaved);
  const { load } = controller;
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = useCallback(() => setSheet(null), []);
  const openRaw = useCallback(() => setSheet({ kind: "raw" }), []);
  const addProvider = useCallback(() => setSheet({ kind: "provider", provider: null }), []);
  const handleReload = useCallback(() => void controller.reload(), [controller]);
  const providers = useMemo(
    () => (load.status === "ready" && load.doc ? readProviders(load.doc) : []),
    [load],
  );

  if (load.status === "loading") {
    return (
      <SettingsSection title="Pi models.json">
        <SettingsCard>
          <SettingsRow label="Loading models.json…" />
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (load.status === "error") {
    return (
      <SettingsSection title="Pi models.json">
        <SettingsCard>
          <SettingsRow label="Could not read models.json" error={load.message}>
            <Button variant="outline" onPress={handleReload}>
              Retry
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <>
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          controller={controller}
          onOpen={setSheet}
        />
      ))}
      <SettingsSection title="Pi models.json">
        <SettingsCard testID="pi-models-file">
          <SettingsRow
            label="File"
            hint={load.file.exists ? load.file.path : `${load.file.path} (not created yet)`}
            error={load.parseError ?? undefined}
          >
            <View style={styles.buttons}>
              <Button variant="ghost" onPress={handleReload} testID="pi-models-reload">
                Reload
              </Button>
              <Button variant="outline" onPress={openRaw} testID="pi-models-raw">
                Edit JSON
              </Button>
            </View>
          </SettingsRow>
          <SettingsRow label="What pi lists" hint={load.file.listing || "(nothing)"} />
          {load.doc ? (
            <SettingsAddRow
              label="Add provider"
              onPress={addProvider}
              testID="pi-models-add-provider"
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      {sheet?.kind === "raw" ? (
        <PiRawSheet text={load.file.text} save={controller.saveText} onClose={close} />
      ) : null}
      {sheet?.kind === "provider" && load.doc ? (
        <PiProviderSheet
          doc={load.doc}
          provider={sheet.provider}
          save={controller.saveDoc}
          onClose={close}
        />
      ) : null}
      {sheet?.kind === "model" && load.doc ? (
        <PiModelSheet
          doc={load.doc}
          provider={sheet.provider}
          model={sheet.model}
          save={controller.saveDoc}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function ProviderCard({
  provider,
  controller,
  onOpen,
}: {
  provider: PiProviderView;
  controller: PiModelsController;
  onOpen: (sheet: OpenSheet) => void;
}) {
  const editProvider = useCallback(
    () => onOpen({ kind: "provider", provider }),
    [onOpen, provider],
  );
  const addModel = useCallback(
    () => onOpen({ kind: "model", provider, model: null }),
    [onOpen, provider],
  );
  const connection = [
    provider.baseUrl || "built-in URL",
    provider.api || "built-in API",
    provider.apiKey ? `key ${provider.apiKey}` : "no key",
  ].join(" · ");
  return (
    <SettingsSection title={`Pi endpoint: ${provider.name || provider.id}`}>
      <SettingsCard testID={`pi-models-provider-${provider.id}`}>
        <SettingsRow label="Connection" hint={connection}>
          <Button variant="outline" onPress={editProvider}>
            Edit
          </Button>
        </SettingsRow>
        {provider.models.map((model) => (
          <ModelRow
            key={`${model.index}:${model.id}`}
            provider={provider}
            model={model}
            controller={controller}
            onOpen={onOpen}
          />
        ))}
        <SettingsAddRow label="Add model" onPress={addModel} />
      </SettingsCard>
    </SettingsSection>
  );
}

/** The level the Test button asks for: high when offered, so it exercises effort with tools. */
function testLevel(model: PiModelView): string | undefined {
  if (!model.reasoning) return undefined;
  if (model.levels.includes("high")) return "high";
  return model.levels[model.levels.length - 1];
}

function describeModel(model: PiModelView): string {
  const parts = [model.id];
  parts.push(model.reasoning ? `thinking: ${model.levels.join(", ") || "none"}` : "no thinking");
  if (model.api) parts.push(model.api);
  if (model.images) parts.push("images");
  return parts.join(" · ");
}

function describeResult(result: PiModelsTestOutput, level: string | undefined): string {
  const parts = [`${result.ok ? "✓" : "✗"} ${result.output.slice(0, 400)}`];
  if (result.ms) parts.push(`${(result.ms / 1000).toFixed(1)} s`);
  if (level) parts.push(level);
  return parts.join(" · ");
}

type TestState = { running: true } | { running: false; result: PiModelsTestOutput | null };

function ModelRow({
  provider,
  model,
  controller,
  onOpen,
}: {
  provider: PiProviderView;
  model: PiModelView;
  controller: PiModelsController;
  onOpen: (sheet: OpenSheet) => void;
}) {
  const [test, setTest] = useState<TestState>({ running: false, result: null });
  const edit = useCallback(
    () => onOpen({ kind: "model", provider, model }),
    [model, onOpen, provider],
  );
  const level = testLevel(model);
  const { test: runTest } = controller;
  const handleTest = useCallback(() => {
    setTest({ running: true });
    void runTest({ provider: provider.id, model: model.id, thinking: level })
      .then((result) => setTest({ running: false, result }))
      .catch((error: unknown) =>
        setTest({ running: false, result: { ok: false, output: toErrorMessage(error), ms: 0 } }),
      );
  }, [level, model.id, provider.id, runTest]);
  const result = test.running ? null : test.result;
  return (
    <SettingsRow
      label={model.name || model.id}
      hint={
        result?.ok
          ? `${describeModel(model)}\n${describeResult(result, level)}`
          : describeModel(model)
      }
      error={result && !result.ok ? describeResult(result, level) : undefined}
      testID={`pi-models-model-${provider.id}-${model.id}`}
    >
      <View style={styles.buttons}>
        <Button variant="ghost" onPress={handleTest} loading={test.running}>
          {test.running ? "Testing…" : "Test"}
        </Button>
        <Button variant="outline" onPress={edit}>
          Edit
        </Button>
      </View>
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
