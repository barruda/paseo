import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  PI_KNOWN_APIS,
  PI_THINKING_LEVELS,
  type PiThinkingLevel,
} from "@getpaseo/protocol/pi-models";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsSelect, SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { toErrorMessage } from "@/utils/error-messages";
import {
  removeModel,
  removeProvider,
  upsertModel,
  upsertProvider,
  type PiModelPatch,
  type PiModelView,
  type PiModelsDocument,
  type PiProviderPatch,
  type PiProviderView,
} from "./document";

// CUSTOM(pi-models): the sheets behind the Pi provider page's models.json editor. Each one edits a
// draft, applies it to the loaded document and saves the whole file; nothing is written until Save.

type Save = (doc: PiModelsDocument) => Promise<string | null>;

/** Runs a save, keeping the sheet open with the error when it fails. */
function useSheetSave(onClose: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    (work: () => Promise<string | null>) => {
      setSaving(true);
      setError(null);
      void (async () => {
        let message: string | null;
        try {
          message = await work();
        } catch (caught) {
          message = toErrorMessage(caught);
        }
        setSaving(false);
        if (message) setError(message);
        else onClose();
      })();
    },
    [onClose],
  );
  return { saving, error, run };
}

function apiOptions(current: string, inheritLabel: string | null) {
  const values: string[] = [...PI_KNOWN_APIS];
  if (current && !values.includes(current)) values.push(current);
  const options = values.map((value) => ({ label: value, value }));
  return inheritLabel === null ? options : [{ label: inheritLabel, value: "" }, ...options];
}

function Field({
  label,
  hint,
  initialValue,
  onChangeText,
  placeholder,
  editable,
  testID,
}: {
  label: string;
  hint?: string;
  initialValue: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  editable: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <FormTextInput
        size="sm"
        initialValue={initialValue}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        accessibilityLabel={label}
        testID={testID}
      />
    </View>
  );
}

function SheetActions({
  saving,
  error,
  onCancel,
  onSave,
  remove,
}: {
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
  remove: { label: string; onConfirm: () => void } | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const askRemove = useCallback(() => setConfirming(true), []);
  return (
    <View style={styles.footer}>
      {error ? (
        <Text selectable style={styles.errorText}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {remove ? (
          <Button
            variant={confirming ? "destructive" : "ghost"}
            size="sm"
            onPress={confirming ? remove.onConfirm : askRemove}
            disabled={saving}
            testID="pi-models-remove"
          >
            {confirming ? `Remove ${remove.label}?` : "Remove"}
          </Button>
        ) : null}
        <View style={styles.spacer} />
        <Button variant="secondary" size="sm" onPress={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={onSave}
          disabled={saving}
          testID="pi-models-save"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </View>
    </View>
  );
}

function Sheet({
  title,
  onClose,
  testID,
  children,
}: {
  title: string;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  const header = useMemo<SheetHeader>(() => ({ title }), [title]);
  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID={testID}>
      <View style={styles.body}>{children}</View>
    </AdaptiveModalSheet>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PiProviderSheet({
  doc,
  provider,
  save,
  onClose,
}: {
  doc: PiModelsDocument;
  provider: PiProviderView | null;
  save: Save;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PiProviderPatch>(() => ({
    id: provider?.id ?? "",
    name: provider?.name ?? "",
    baseUrl: provider?.baseUrl ?? "",
    api: provider?.api ?? "openai-completions",
    apiKey: provider?.apiKey ?? "",
  }));
  const { saving, error, run } = useSheetSave(onClose);
  const set = useCallback(
    (field: keyof PiProviderPatch) => (value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    [],
  );
  const setId = useMemo(() => set("id"), [set]);
  const setName = useMemo(() => set("name"), [set]);
  const setBaseUrl = useMemo(() => set("baseUrl"), [set]);
  const setApi = useMemo(() => set("api"), [set]);
  const setApiKey = useMemo(() => set("apiKey"), [set]);
  const handleSave = useCallback(
    () => run(() => save(upsertProvider(doc, provider?.id ?? null, draft))),
    [doc, draft, provider, run, save],
  );
  const removeAction = useMemo(
    () =>
      provider
        ? {
            label: provider.id,
            onConfirm: () => run(() => save(removeProvider(doc, provider.id))),
          }
        : null,
    [doc, provider, run, save],
  );
  return (
    <Sheet
      title={provider ? `Pi endpoint ${provider.id}` : "Add Pi endpoint"}
      onClose={onClose}
      testID="pi-models-provider-sheet"
    >
      <Field
        label="ID"
        hint="Used in --model <id>/<model>. A built-in id (openai, anthropic...) changes that provider."
        initialValue={draft.id}
        onChangeText={setId}
        placeholder="fuelix"
        editable={!saving}
        testID="pi-models-provider-id"
      />
      <Field
        label="Name"
        initialValue={draft.name}
        onChangeText={setName}
        placeholder="Optional display name"
        editable={!saving}
      />
      <Field
        label="Base URL"
        initialValue={draft.baseUrl}
        onChangeText={setBaseUrl}
        placeholder="https://api.example.com/v1"
        editable={!saving}
        testID="pi-models-provider-url"
      />
      <Field
        label="API key"
        hint='Literal key, "$ENV_NAME" (read from the environment pi runs in) or "!command".'
        initialValue={draft.apiKey}
        onChangeText={setApiKey}
        editable={!saving}
        testID="pi-models-provider-key"
      />
      <SettingsCard>
        <SettingsSelect
          label="API"
          hint="How pi talks to the endpoint. A model can override it."
          value={draft.api}
          options={apiOptions(draft.api, "Built-in")}
          onValueChange={setApi}
          disabled={saving}
        />
      </SettingsCard>
      <SheetActions
        saving={saving}
        error={error}
        onCancel={onClose}
        onSave={handleSave}
        remove={removeAction}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export function PiModelSheet({
  doc,
  provider,
  model,
  save,
  onClose,
}: {
  doc: PiModelsDocument;
  provider: PiProviderView;
  model: PiModelView | null;
  save: Save;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PiModelPatch>(() => ({
    id: model?.id ?? "",
    name: model?.name ?? "",
    api: model?.api ?? "",
    reasoning: model?.reasoning ?? false,
    contextWindow: model?.contextWindow ?? "",
    maxTokens: model?.maxTokens ?? "",
    images: model?.images ?? false,
    levels: model?.levels ?? ["off", "minimal", "low", "medium", "high"],
  }));
  const { saving, error, run } = useSheetSave(onClose);
  const setText = useCallback(
    (field: "id" | "name" | "api" | "contextWindow" | "maxTokens") => (value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    [],
  );
  const setId = useMemo(() => setText("id"), [setText]);
  const setName = useMemo(() => setText("name"), [setText]);
  const setApi = useMemo(() => setText("api"), [setText]);
  const setContext = useMemo(() => setText("contextWindow"), [setText]);
  const setMaxTokens = useMemo(() => setText("maxTokens"), [setText]);
  const setReasoning = useCallback(
    (reasoning: boolean) => setDraft((current) => ({ ...current, reasoning })),
    [],
  );
  const setImages = useCallback(
    (images: boolean) => setDraft((current) => ({ ...current, images })),
    [],
  );
  const toggleLevel = useCallback(
    (level: PiThinkingLevel) =>
      setDraft((current) => ({
        ...current,
        levels: current.levels.includes(level)
          ? current.levels.filter((item) => item !== level)
          : PI_THINKING_LEVELS.filter((item) => item === level || current.levels.includes(item)),
      })),
    [],
  );
  const handleSave = useCallback(
    () => run(() => save(upsertModel(doc, provider.id, model?.index ?? null, draft))),
    [doc, draft, model, provider.id, run, save],
  );
  const removeAction = useMemo(
    () =>
      model
        ? {
            label: model.id,
            onConfirm: () => run(() => save(removeModel(doc, provider.id, model.index))),
          }
        : null,
    [doc, model, provider.id, run, save],
  );
  const providerApi = provider.api || "built-in";
  return (
    <Sheet
      title={`${model ? model.name || model.id : "Add model"} (${provider.id})`}
      onClose={onClose}
      testID="pi-models-model-sheet"
    >
      <Field
        label="Model ID"
        hint="Sent to the API as is."
        initialValue={draft.id}
        onChangeText={setId}
        placeholder="gpt-6.2-sol"
        editable={!saving}
        testID="pi-models-model-id"
      />
      <Field
        label="Name"
        initialValue={draft.name}
        onChangeText={setName}
        placeholder="Shown in the model picker"
        editable={!saving}
      />
      <SettingsCard>
        <SettingsSelect
          label="API"
          hint="Some endpoints only take effort with tools on openai-responses."
          value={draft.api}
          options={apiOptions(draft.api, `Endpoint's (${providerApi})`)}
          onValueChange={setApi}
          disabled={saving}
        />
        <SettingsSwitch
          label="Thinking"
          hint="Shows the effort picker for this model."
          value={draft.reasoning}
          onValueChange={setReasoning}
          disabled={saving}
        />
        <SettingsSwitch
          label="Images"
          hint="The model accepts image input."
          value={draft.images}
          onValueChange={setImages}
          disabled={saving}
        />
      </SettingsCard>
      {draft.reasoning ? (
        <View style={styles.field}>
          <Text style={styles.label}>Effort levels</Text>
          <Text style={styles.hint}>
            The levels the endpoint accepts. A level left out is unsupported and pi uses the nearest
            one, so an endpoint that rejects &quot;none&quot; works with Off unchecked.
          </Text>
          <View style={styles.chips}>
            {PI_THINKING_LEVELS.map((level) => (
              <LevelChip
                key={level}
                level={level}
                selected={draft.levels.includes(level)}
                disabled={saving}
                onToggle={toggleLevel}
              />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Field
            label="Context window"
            initialValue={draft.contextWindow}
            onChangeText={setContext}
            placeholder="128000"
            editable={!saving}
          />
        </View>
        <View style={styles.rowItem}>
          <Field
            label="Max output tokens"
            initialValue={draft.maxTokens}
            onChangeText={setMaxTokens}
            placeholder="16384"
            editable={!saving}
          />
        </View>
      </View>
      <SheetActions
        saving={saving}
        error={error}
        onCancel={onClose}
        onSave={handleSave}
        remove={removeAction}
      />
    </Sheet>
  );
}

function LevelChip({
  level,
  selected,
  disabled,
  onToggle,
}: {
  level: PiThinkingLevel;
  selected: boolean;
  disabled: boolean;
  onToggle: (level: PiThinkingLevel) => void;
}) {
  const handlePress = useCallback(() => onToggle(level), [level, onToggle]);
  return (
    <Button
      variant={selected ? "default" : "outline"}
      size="sm"
      onPress={handlePress}
      disabled={disabled}
      accessibilityLabel={`${level}${selected ? " (on)" : " (off)"}`}
      testID={`pi-models-level-${level}`}
    >
      {level}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Raw JSON
// ---------------------------------------------------------------------------

export function PiRawSheet({
  text,
  save,
  onClose,
}: {
  text: string;
  save: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const { saving, error, run } = useSheetSave(onClose);
  const handleSave = useCallback(() => run(() => save(draft)), [draft, run, save]);
  return (
    <Sheet title="Pi models.json" onClose={onClose} testID="pi-models-raw-sheet">
      <FormTextInput
        size="sm"
        multiline
        initialValue={text}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        style={styles.raw}
        accessibilityLabel="models.json"
        testID="pi-models-raw-input"
      />
      <SheetActions
        saving={saving}
        error={error}
        onCancel={onClose}
        onSave={handleSave}
        remove={null}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  field: {
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
  row: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  rowItem: {
    flex: 1,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  raw: {
    minHeight: 360,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  footer: {
    gap: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  spacer: {
    flex: 1,
  },
}));
