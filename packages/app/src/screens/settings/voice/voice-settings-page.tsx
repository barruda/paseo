// CUSTOM(voice-settings): Settings > Voice and dictation, a host page. The host's speech
// settings ride on the daemon config; the live status, previews and folder checks are
// speech.local.* RPCs. The thinking tone is a per-device setting.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert as NativeAlert, ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { StyleSheet } from "react-native-unistyles";
import { Buffer } from "buffer";
import * as Clipboard from "expo-clipboard";
import type {
  MutableSpeechConfig,
  SpeechCustomModel,
  SpeechLocalStatus,
} from "@getpaseo/protocol/speech-settings";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsRow, SettingsSelect, SettingsSwitch } from "@/components/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { getIsElectron } from "@/constants/platform";
import { pickDirectory } from "@/desktop/pick-directory";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import {
  scalePcm16,
  thinkingToneGain,
  useThinkingToneStore,
  type ThinkingToneVolume,
} from "@/voice/thinking-tone-settings";
import { useLocalSpeechStatus } from "./use-local-speech-status";
import {
  deriveEngineState,
  describeSpeaker,
  engineBadge,
  findModel,
  formatBytes,
  formatDuration,
  isEnvControlled,
  modelAvailability,
  modelsOfKind,
  nearestSpeed,
  pcmMimeType,
  previewTextFor,
  sortModels,
  SPEED_VALUES,
  type SettingField,
  type SpeakerInfo,
  type SpeechModelKind,
} from "./voice-settings-model";

type SaveSpeech = (patch: MutableSpeechConfig) => Promise<void>;

const ENV_NAME_BY_FIELD: Record<SettingField, string> = {
  dictationSttModel: "PASEO_DICTATION_LOCAL_STT_MODEL",
  voiceSttModel: "PASEO_VOICE_LOCAL_STT_MODEL",
  voiceTtsModel: "PASEO_VOICE_LOCAL_TTS_MODEL",
  voiceTtsSpeakerId: "PASEO_VOICE_LOCAL_TTS_SPEAKER_ID",
  voiceTtsSpeed: "PASEO_VOICE_LOCAL_TTS_SPEED",
  modelsDir: "PASEO_LOCAL_MODELS_DIR",
};

const EMPTY_CUSTOM_MODELS: SpeechCustomModel[] = [];
const PCM16_TONE_MIME = "audio/pcm;rate=16000;bits=16";

function localClock(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 8);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envHint(status: SpeechLocalStatus, field: SettingField, t: TFunction): string | undefined {
  return isEnvControlled(status, field)
    ? t("settings.voiceSettings.models.envControlled", { name: ENV_NAME_BY_FIELD[field] })
    : undefined;
}

export function VoiceSettingsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const [showLogs, setShowLogs] = useState(false);
  const state = useLocalSpeechStatus(serverId, { includeLogs: showLogs, live: isFocused });
  const { config, patchConfig } = useDaemonConfig(serverId);
  const speech = config?.speech;
  const toggleLogs = useCallback(() => setShowLogs((value) => !value), []);

  const saveSpeech = useCallback<SaveSpeech>(
    async (patch) => {
      try {
        await patchConfig({ speech: patch });
      } catch (error) {
        NativeAlert.alert(t("settings.voiceSettings.saveError"), errorMessage(error));
      }
    },
    [patchConfig, t],
  );

  if (state.status === "offline") {
    return <Alert variant="info" description={t("settings.voiceSettings.offline")} />;
  }
  if (state.status === "unsupported") {
    return (
      <Alert
        variant="warning"
        title={t("settings.voiceSettings.updateTitle")}
        description={t("settings.voiceSettings.updateBody")}
      />
    );
  }
  if (state.status === "error") {
    return (
      <Alert
        variant="error"
        title={t("settings.voiceSettings.loadError")}
        description={state.message}
      />
    );
  }
  if (state.status === "loading" || !speech) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  const status = state.data;
  return (
    <View style={styles.page} testID="voice-settings">
      <StatusSection status={status} />
      <EngineSection status={status} speech={speech} save={saveSpeech} />
      <ModelsSection serverId={serverId} status={status} speech={speech} save={saveSpeech} />
      <VoiceSection serverId={serverId} status={status} speech={speech} save={saveSpeech} />
      <InstructionsSection status={status} speech={speech} save={saveSpeech} />
      <ThinkingToneSection />
      <LogsSection status={status} visible={showLogs} onToggle={toggleLogs} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

// Polls return the same data while nothing changes, so the uptime needs its own clock.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function useStatusText(status: SpeechLocalStatus) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const engine = deriveEngineState(status);
  const badge = engineBadge(engine);
  const provider =
    badge.provider === "cuda"
      ? t("settings.voiceSettings.status.gpu")
      : t("settings.voiceSettings.status.cpu");
  const label = t(`settings.voiceSettings.status.${badge.labelKey}`, { provider });
  let hint = badge.hintKey ? t(`settings.voiceSettings.status.${badge.hintKey}`) : "";
  if (engine.kind === "downloading") {
    hint = engine.modelIds.map((id) => findModel(status.models, id)?.label ?? id).join(", ");
  } else if (engine.kind === "unavailable") {
    hint = engine.message;
  }

  const worker = status.worker;
  const memory = [
    worker.rssBytes === null
      ? null
      : t("settings.voiceSettings.status.ram", { value: formatBytes(worker.rssBytes) }),
    worker.vramBytes === null
      ? null
      : t("settings.voiceSettings.status.vram", { value: formatBytes(worker.vramBytes) }),
    worker.cpuPercent === null
      ? null
      : t("settings.voiceSettings.status.cpuUsage", { value: worker.cpuPercent }),
  ]
    .filter(Boolean)
    .join(" · ");
  const process =
    worker.running && worker.pid !== null && worker.startedAt
      ? t("settings.voiceSettings.status.processValue", {
          pid: worker.pid,
          uptime: formatDuration(worker.startedAt, now),
        })
      : t("settings.voiceSettings.status.notRunning");
  const loaded = worker.loadedModels
    .map((id) => findModel(status.models, id)?.label ?? id)
    .join(", ");
  const readiness = (feature: { available: boolean; message: string }) =>
    feature.available ? t("settings.voiceSettings.status.ready") : feature.message;

  return {
    badge: { label, variant: badge.variant, hint },
    memory: memory || t("settings.voiceSettings.status.measuring"),
    process,
    loaded: loaded || t("settings.voiceSettings.status.noneLoaded"),
    dictation: readiness(status.readiness.dictation),
    voice: readiness(status.readiness.voice),
  };
}

function StatusSection({ status }: { status: SpeechLocalStatus }) {
  const { t } = useTranslation();
  const text = useStatusText(status);
  const device = status.gpuDevice;

  return (
    <SettingsSection title={t("settings.voiceSettings.status.title")}>
      <SettingsCard testID="voice-settings-status">
        <SettingsRow label={t("settings.voiceSettings.status.engine")} hint={text.badge.hint}>
          <StatusBadge label={text.badge.label} variant={text.badge.variant} />
        </SettingsRow>
        <SettingsRow label={t("settings.voiceSettings.status.process")} hint={text.process} />
        {status.worker.running ? (
          <SettingsRow label={t("settings.voiceSettings.status.memory")} hint={text.memory} />
        ) : null}
        {status.worker.running ? (
          <SettingsRow label={t("settings.voiceSettings.status.loadedModels")} hint={text.loaded} />
        ) : null}
        {device ? (
          <SettingsRow
            label={device.name}
            hint={t("settings.voiceSettings.status.gpuDeviceValue", {
              used: formatBytes(device.memoryUsedBytes),
              total: formatBytes(device.memoryTotalBytes),
              utilization: device.utilizationPercent ?? 0,
            })}
          />
        ) : null}
        <SettingsRow label={t("settings.voiceSettings.status.dictation")} hint={text.dictation} />
        <SettingsRow label={t("settings.voiceSettings.status.voice")} hint={text.voice} />
      </SettingsCard>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function EngineSection({
  status,
  speech,
  save,
}: {
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const requested = (speech.executionProvider ?? status.engine.requestedProvider) === "cuda";
  const fallback = requested && status.engine.effectiveProvider !== "cuda";
  const handleChange = useCallback(
    (useGpu: boolean) => void save({ executionProvider: useGpu ? "cuda" : "cpu" }),
    [save],
  );

  return (
    <SettingsSection title={t("settings.voiceSettings.engine.title")}>
      <SettingsCard>
        <SettingsSwitch
          label={t("settings.voiceSettings.engine.useGpu")}
          hint={
            status.engine.gpuAvailable
              ? t("settings.voiceSettings.engine.useGpuHint")
              : (status.engine.gpuUnavailableReason ?? undefined)
          }
          error={
            fallback
              ? t("settings.voiceSettings.engine.fallback", {
                  reason: status.engine.gpuUnavailableReason ?? "",
                })
              : null
          }
          value={requested}
          onValueChange={handleChange}
          disabled={!status.engine.gpuAvailable && !requested}
          testID="voice-settings-use-gpu"
        />
      </SettingsCard>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function useModelOptions(status: SpeechLocalStatus, kind: SpeechModelKind) {
  const { t } = useTranslation();
  return useMemo(
    () =>
      sortModels(modelsOfKind(status.models, kind)).map((model) => {
        const availability = modelAvailability(model);
        const state = t(`settings.voiceSettings.models.${availability}`, {
          size: formatBytes((model.downloadSizeMb ?? 0) * 1024 * 1024),
        });
        return { value: model.id, label: `${model.label} · ${state}` };
      }),
    [kind, status.models, t],
  );
}

function ModelsSection({
  serverId,
  status,
  speech,
  save,
}: {
  serverId: string;
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const sttOptions = useModelOptions(status, "stt");
  const ttsOptions = useModelOptions(status, "tts");
  const customModels = speech.customModels ?? EMPTY_CUSTOM_MODELS;
  const selectedIds = useMemo(
    () => [speech.dictationSttModel, speech.voiceSttModel, speech.voiceTtsModel],
    [speech.dictationSttModel, speech.voiceSttModel, speech.voiceTtsModel],
  );

  const selectDictation = useCallback(
    (value: string) => void save({ dictationSttModel: value }),
    [save],
  );
  const selectVoiceStt = useCallback(
    (value: string) => void save({ voiceSttModel: value }),
    [save],
  );
  const selectVoiceTts = useCallback(
    (value: string) => void save({ voiceTtsModel: value, voiceTtsSpeakerId: 0 }),
    [save],
  );
  const removeCustom = useCallback(
    (id: string) => {
      if (selectedIds.includes(id)) {
        NativeAlert.alert(t("settings.voiceSettings.models.removeInUse"));
        return;
      }
      void save({ customModels: customModels.filter((model) => model.id !== id) });
    },
    [customModels, save, selectedIds, t],
  );

  return (
    <SettingsSection
      title={t("settings.voiceSettings.models.title")}
      info={t("settings.voiceSettings.models.info")}
    >
      <SettingsCard testID="voice-settings-models">
        <SettingsSelect
          label={t("settings.voiceSettings.models.dictation")}
          hint={envHint(status, "dictationSttModel", t)}
          value={speech.dictationSttModel ?? ""}
          options={sttOptions}
          onValueChange={selectDictation}
          disabled={isEnvControlled(status, "dictationSttModel")}
          testID="voice-settings-dictation-model"
        />
        <SettingsSelect
          label={t("settings.voiceSettings.models.voiceRecognition")}
          hint={envHint(status, "voiceSttModel", t)}
          value={speech.voiceSttModel ?? ""}
          options={sttOptions}
          onValueChange={selectVoiceStt}
          disabled={isEnvControlled(status, "voiceSttModel")}
          testID="voice-settings-voice-stt-model"
        />
        <SettingsSelect
          label={t("settings.voiceSettings.models.voiceSynthesis")}
          hint={envHint(status, "voiceTtsModel", t)}
          value={speech.voiceTtsModel ?? ""}
          options={ttsOptions}
          onValueChange={selectVoiceTts}
          disabled={isEnvControlled(status, "voiceTtsModel")}
          testID="voice-settings-voice-tts-model"
        />
        {customModels.map((model) => (
          <CustomModelRow key={model.id} model={model} onRemove={removeCustom} />
        ))}
        <AddModelFolderRow serverId={serverId} customModels={customModels} save={save} />
      </SettingsCard>
    </SettingsSection>
  );
}

function CustomModelRow({
  model,
  onRemove,
}: {
  model: SpeechCustomModel;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const remove = useCallback(() => onRemove(model.id), [model.id, onRemove]);
  return (
    <SettingsRow label={model.label ?? model.id} hint={model.path}>
      <Button variant="outline" size="sm" onPress={remove}>
        {t("settings.voiceSettings.models.remove")}
      </Button>
    </SettingsRow>
  );
}

function AddModelFolderRow({
  serverId,
  customModels,
  save,
}: {
  serverId: string;
  customModels: SpeechCustomModel[];
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const canBrowse = getIsElectron() && isLocalDaemon;
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const add = useCallback(
    async (folder: string) => {
      if (!client || !folder.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const result = await client.inspectLocalSpeechModelFolder(folder.trim());
        const model = result.model;
        if (!model) {
          throw new Error(result.error ?? t("settings.voiceSettings.models.addError"));
        }
        if (!customModels.some((existing) => existing.id === model.id)) {
          await save({ customModels: [...customModels, model] });
        }
        setPath("");
        setInputKey((key) => key + 1);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [client, customModels, save, t],
  );

  const handleBrowse = useCallback(() => {
    void pickDirectory()
      .then((folder) => (folder ? add(folder) : undefined))
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, [add]);
  const handleAdd = useCallback(() => void add(path), [add, path]);

  return (
    <SettingsRow
      label={t("settings.voiceSettings.models.addFolder")}
      hint={t("settings.voiceSettings.models.addFolderHint")}
      error={error}
      testID="voice-settings-add-folder"
    >
      {canBrowse ? (
        <Button variant="outline" size="sm" onPress={handleBrowse} disabled={busy}>
          {t("settings.voiceSettings.models.browse")}
        </Button>
      ) : (
        <View style={styles.inlineControls}>
          <FormTextInput
            key={inputKey}
            initialValue=""
            onChangeText={setPath}
            placeholder={t("settings.voiceSettings.models.folderPath")}
            accessibilityLabel={t("settings.voiceSettings.models.folderPath")}
            size="sm"
            style={styles.pathInput}
          />
          <Button variant="outline" size="sm" onPress={handleAdd} disabled={busy || !path.trim()}>
            {t("settings.voiceSettings.models.add")}
          </Button>
        </View>
      )}
    </SettingsRow>
  );
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

function useAudioPlayer() {
  const engine = useVoiceAudioEngineOptional();
  return useCallback(
    async (pcm: Uint8Array, mimeType: string) => {
      if (!engine) throw new Error("Audio playback is unavailable here.");
      await engine.initialize();
      engine.stop();
      await engine.play({
        type: mimeType,
        size: pcm.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(pcm).buffer;
        },
      });
    },
    [engine],
  );
}

function useSpeakerLabel() {
  const { t } = useTranslation();
  return useCallback(
    (info: SpeakerInfo) =>
      [
        info.name,
        info.language === "unknown" ? null : t(`settings.voiceSettings.languages.${info.language}`),
        info.gender ? t(`settings.voiceSettings.voice.${info.gender}`) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [t],
  );
}

function VoiceSection({
  serverId,
  status,
  speech,
  save,
}: {
  serverId: string;
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const play = useAudioPlayer();
  const speakerLabel = useSpeakerLabel();
  const model = findModel(status.models, speech.voiceTtsModel);
  const speakers = useMemo(
    () => (model?.speakers ?? []).map((name, id) => describeSpeaker(name, id)),
    [model?.speakers],
  );
  const speakerId = speech.voiceTtsSpeakerId ?? 0;
  const speaker = speakers[speakerId];
  const speed = nearestSpeed(speech.voiceTtsSpeed);
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const triggerRef = useRef<View>(null);

  const options = useMemo(
    () => speakers.map((info) => ({ id: String(info.id), label: speakerLabel(info) })),
    [speakerLabel, speakers],
  );
  const speedOptions = useMemo(
    () => SPEED_VALUES.map((value) => ({ value: String(value), label: `${value}×` })),
    [],
  );

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleSelectSpeaker = useCallback(
    (id: string) => {
      setOpen(false);
      void save({ voiceTtsSpeakerId: Number(id) });
    },
    [save],
  );
  const handleSpeed = useCallback(
    (value: string) => void save({ voiceTtsSpeed: Number(value) }),
    [save],
  );
  const handlePreview = useCallback(() => {
    if (!client) return;
    setPreviewing(true);
    setPreviewError(null);
    void client
      .previewLocalSpeechVoice({
        text: previewTextFor(speaker?.language ?? "enUS"),
        speakerId,
        speed,
      })
      .then((result) => {
        if (!result.audio || !result.format) {
          throw new Error(result.error ?? t("settings.voiceSettings.voice.previewError"));
        }
        return play(
          Uint8Array.from(Buffer.from(result.audio, "base64")),
          pcmMimeType(result.format),
        );
      })
      .catch((cause: unknown) => setPreviewError(errorMessage(cause)))
      .finally(() => setPreviewing(false));
  }, [client, play, speaker?.language, speakerId, speed, t]);

  if (!model || speakers.length === 0) return null;

  return (
    <SettingsSection title={t("settings.voiceSettings.voice.title")}>
      <SettingsCard testID="voice-settings-voice">
        <SettingsRow
          label={t("settings.voiceSettings.voice.speaker")}
          hint={envHint(status, "voiceTtsSpeakerId", t)}
        >
          <ComboboxTrigger
            ref={triggerRef}
            onPress={handleOpen}
            disabled={isEnvControlled(status, "voiceTtsSpeakerId")}
            accessibilityRole="button"
            accessibilityLabel={t("settings.voiceSettings.voice.speaker")}
            testID="voice-settings-speaker"
          >
            <Text style={styles.triggerLabel} numberOfLines={1}>
              {speaker ? speakerLabel(speaker) : String(speakerId)}
            </Text>
          </ComboboxTrigger>
          <Combobox
            options={options}
            value={String(speakerId)}
            onSelect={handleSelectSpeaker}
            open={open}
            onOpenChange={setOpen}
            anchorRef={triggerRef}
            searchable={options.length > 12}
            title={t("settings.voiceSettings.voice.speaker")}
            desktopMinWidth={300}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.voiceSettings.voice.speed")}
          hint={envHint(status, "voiceTtsSpeed", t)}
        >
          <SegmentedControl
            options={speedOptions}
            value={String(speed)}
            onValueChange={handleSpeed}
            size="sm"
            testID="voice-settings-speed"
          />
        </SettingsRow>
        <SettingsRow label={t("settings.voiceSettings.voice.preview")} error={previewError}>
          <Button
            variant="outline"
            size="sm"
            onPress={handlePreview}
            disabled={previewing}
            testID="voice-settings-preview"
          >
            {previewing
              ? t("settings.voiceSettings.voice.previewing")
              : t("settings.voiceSettings.voice.play")}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Voice mode instructions
// ---------------------------------------------------------------------------

function InstructionsSection({
  status,
  speech,
  save,
}: {
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const custom = speech.voiceInstructions?.trim() ?? "";
  const current = custom || status.defaultVoiceInstructions;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [draftKey, setDraftKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.voiceSettings.instructions.title") }),
    [t],
  );

  const open = useCallback(() => {
    setDraft(current);
    setDraftKey((key) => key + 1);
    setEditing(true);
  }, [current]);
  const close = useCallback(() => {
    if (!saving) setEditing(false);
  }, [saving]);
  const restoreBuiltIn = useCallback(() => {
    setDraft(status.defaultVoiceInstructions);
    setDraftKey((key) => key + 1);
  }, [status.defaultVoiceInstructions]);
  const submit = useCallback(() => {
    const text = draft.trim();
    setSaving(true);
    void save({ voiceInstructions: text === status.defaultVoiceInstructions ? "" : text }).finally(
      () => {
        setSaving(false);
        setEditing(false);
      },
    );
  }, [draft, save, status.defaultVoiceInstructions]);

  return (
    <SettingsSection title={t("settings.voiceSettings.instructions.title")}>
      <SettingsCard>
        <SettingsRow
          label={
            custom
              ? t("settings.voiceSettings.instructions.custom")
              : t("settings.voiceSettings.instructions.builtIn")
          }
          hint={t("settings.voiceSettings.instructions.hint")}
        >
          <Button variant="outline" size="sm" onPress={open} testID="voice-settings-instructions">
            {t("settings.voiceSettings.instructions.edit")}
          </Button>
        </SettingsRow>
      </SettingsCard>
      {editing ? (
        <AdaptiveModalSheet header={header} visible onClose={close} desktopMaxWidth={640}>
          <SettingsTextAreaCard
            key={draftKey}
            accessibilityLabel={t("settings.voiceSettings.instructions.title")}
            value={draft}
            onChangeText={setDraft}
            style={styles.instructionsInput}
          />
          <View style={styles.sheetActions}>
            <Button variant="ghost" size="sm" onPress={restoreBuiltIn} disabled={saving}>
              {t("settings.voiceSettings.instructions.useBuiltIn")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={submit}
              disabled={saving || !draft.trim() || draft.trim() === current}
            >
              {saving
                ? t("settings.voiceSettings.instructions.saving")
                : t("settings.voiceSettings.instructions.save")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Thinking tone (this device)
// ---------------------------------------------------------------------------

function ThinkingToneSection() {
  const { t } = useTranslation();
  const enabled = useThinkingToneStore((state) => state.enabled);
  const volume = useThinkingToneStore((state) => state.volume);
  const update = useThinkingToneStore((state) => state.update);
  const play = useAudioPlayer();
  const [error, setError] = useState<string | null>(null);
  const volumeOptions = useMemo(
    () =>
      (["low", "medium", "high"] as const).map((value) => ({
        value,
        label: t(`settings.voiceSettings.thinkingTone.${value}`),
      })),
    [t],
  );

  const handleEnabled = useCallback((value: boolean) => update({ enabled: value }), [update]);
  const handleVolume = useCallback(
    (value: ThinkingToneVolume) => update({ volume: value }),
    [update],
  );
  const handlePreview = useCallback(() => {
    setError(null);
    const pcm = Uint8Array.from(Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64"));
    void play(scalePcm16(pcm, thinkingToneGain(volume)), PCM16_TONE_MIME).catch((cause: unknown) =>
      setError(errorMessage(cause)),
    );
  }, [play, volume]);

  return (
    <SettingsSection
      title={t("settings.voiceSettings.thinkingTone.title")}
      info={t("settings.voiceSettings.thinkingTone.info")}
    >
      <SettingsCard testID="voice-settings-thinking-tone">
        <SettingsSwitch
          label={t("settings.voiceSettings.thinkingTone.enabled")}
          value={enabled}
          onValueChange={handleEnabled}
        />
        {enabled ? (
          <SettingsRow label={t("settings.voiceSettings.thinkingTone.volume")} error={error}>
            <View style={styles.inlineControls}>
              <SegmentedControl
                options={volumeOptions}
                value={volume}
                onValueChange={handleVolume}
                size="sm"
              />
              <Button variant="outline" size="sm" onPress={handlePreview}>
                {t("settings.voiceSettings.voice.play")}
              </Button>
            </View>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

type LogEntry = SpeechLocalStatus["logs"][number];

function LogLine({ entry }: { entry: LogEntry }) {
  const warn = entry.level === "warn" || entry.level === "error";
  return (
    <Text style={warn ? styles.logLineWarn : styles.logLine} selectable>
      {localClock(entry.time)} {entry.message}
      {entry.detail ? <Text style={styles.logDetail}> {entry.detail}</Text> : null}
    </Text>
  );
}

function LogsSection({
  status,
  visible,
  onToggle,
}: {
  status: SpeechLocalStatus;
  visible: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const text = useMemo(
    () =>
      status.logs
        .map((entry) =>
          [localClock(entry.time), entry.level.padEnd(5), entry.message, entry.detail ?? ""]
            .join("  ")
            .trimEnd(),
        )
        .join("\n"),
    [status.logs],
  );
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(text).then(() => setCopied(true));
  }, [text]);

  return (
    <SettingsSection title={t("settings.voiceSettings.logs.title")}>
      <SettingsCard testID="voice-settings-logs">
        <SettingsRow
          label={t("settings.voiceSettings.logs.recent")}
          hint={t("settings.voiceSettings.logs.hint")}
        >
          <View style={styles.inlineControls}>
            {visible && status.logs.length > 0 ? (
              <Button variant="ghost" size="sm" onPress={copy}>
                {copied
                  ? t("settings.voiceSettings.logs.copied")
                  : t("settings.voiceSettings.logs.copy")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onPress={onToggle}>
              {visible
                ? t("settings.voiceSettings.logs.hide")
                : t("settings.voiceSettings.logs.show")}
            </Button>
          </View>
        </SettingsRow>
        {visible ? (
          <ScrollView
            style={styles.logsScroll}
            contentContainerStyle={styles.logs}
            nestedScrollEnabled
          >
            {status.logs.length === 0 ? (
              <Text style={settingsStyles.rowHint}>{t("settings.voiceSettings.logs.empty")}</Text>
            ) : (
              status.logs.map((entry) => (
                <LogLine
                  key={`${entry.time}|${entry.message}|${entry.detail ?? ""}`}
                  entry={entry}
                />
              ))
            )}
          </ScrollView>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: {
    gap: theme.spacing[6],
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  inlineControls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  pathInput: {
    minWidth: 220,
  },
  triggerLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    maxWidth: 260,
  },
  instructionsInput: {
    minHeight: 220,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  logsScroll: {
    maxHeight: 420,
  },
  logs: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1],
  },
  logLine: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  logLineWarn: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  logDetail: {
    color: theme.colors.foregroundMuted,
  },
}));
