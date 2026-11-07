// CUSTOM(dictation-tuning): Settings > Voice and dictation > Dictation tuning. How dictation
// cuts and re-transcribes its audio. Rows the dictation model doesn't read are dimmed and
// locked with a note; rows an env var sets are locked like the other host settings.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  DictationTuningStatus,
  MutableSpeechConfig,
  SpeechLocalStatus,
} from "@getpaseo/protocol/speech-settings";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import {
  SettingsCard,
  SettingsInfoTip,
  SettingsRow,
  SettingsSelect,
  SettingsSection,
} from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import {
  DICTATION_TUNING_CONFIG_KEY,
  dictationModelLabel,
  dictationTuningRowState,
  tuningOptionValues,
  type DictationTuningField,
  type DictationTuningNumberField,
} from "./dictation-tuning-model";

type SaveSpeech = (patch: MutableSpeechConfig) => Promise<void>;

const ENV_NAME: Record<DictationTuningField, string> = {
  autoCommitSeconds: "PASEO_DICTATION_AUTO_COMMIT_SECONDS",
  silencePeakThreshold: "PASEO_DICTATION_SILENCE_PEAK_THRESHOLD",
  decodeIntervalMs: "PASEO_DICTATION_DECODE_INTERVAL_MS",
  prompt: "PASEO_DICTATION_TRANSCRIPTION_PROMPT",
};

const PREFIX = "settings.voiceSettings.dictationTuning";

export function DictationTuningSection({
  status,
  speech,
  save,
}: {
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const tuning = status.dictationTuning;
  // Daemons from before this setting send no tuning status; there is nothing to show.
  if (!tuning) return null;
  const title = t(`${PREFIX}.title`);
  return (
    <SettingsSection title={title} info={t(`${PREFIX}.info`)} testID="voice-settings-tuning">
      <SettingsCard>
        <NumberRow
          field="autoCommitSeconds"
          status={status}
          tuning={tuning}
          speech={speech}
          save={save}
        />
        <NumberRow
          field="decodeIntervalMs"
          status={status}
          tuning={tuning}
          speech={speech}
          save={save}
        />
        <NumberRow
          field="silencePeakThreshold"
          status={status}
          tuning={tuning}
          speech={speech}
          save={save}
        />
        <PromptRow status={status} tuning={tuning} speech={speech} save={save} />
      </SettingsCard>
    </SettingsSection>
  );
}

function useRowChrome(
  status: SpeechLocalStatus,
  tuning: DictationTuningStatus,
  field: DictationTuningField,
) {
  const { t } = useTranslation();
  const state = dictationTuningRowState(status, tuning, field);
  const label = t(`${PREFIX}.${field}.label`);
  let hint: string | undefined;
  if (state.kind === "unsupported") {
    hint = t(`${PREFIX}.unsupported`, { model: dictationModelLabel(status, tuning) });
  } else if (state.kind === "envControlled") {
    hint = t("settings.voiceSettings.models.envControlled", { name: ENV_NAME[field] });
  }
  return {
    label,
    hint,
    locked: state.kind !== "editable",
    dimmed: state.kind === "unsupported",
    infoTip: <SettingsInfoTip title={label} info={t(`${PREFIX}.${field}.info`)} />,
  };
}

function DimWhen({ dimmed, children }: { dimmed: boolean; children: ReactNode }) {
  return <View style={dimmed ? styles.dimmed : undefined}>{children}</View>;
}

function formatValue(field: DictationTuningNumberField, value: number, t: (key: string) => string) {
  if (field === "autoCommitSeconds") {
    return value === 0 ? t(`${PREFIX}.off`) : `${value} s`;
  }
  if (field === "decodeIntervalMs") return `${value} ms`;
  return String(value);
}

function NumberRow({
  field,
  status,
  tuning,
  speech,
  save,
}: {
  field: DictationTuningNumberField;
  status: SpeechLocalStatus;
  tuning: DictationTuningStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const chrome = useRowChrome(status, tuning, field);
  const configKey = DICTATION_TUNING_CONFIG_KEY[field];
  const defaultValue = tuning.defaults[field];
  const current = speech[configKey] ?? defaultValue;
  const options = useMemo(
    () =>
      tuningOptionValues(field, current).map((value) => {
        const text = formatValue(field, value, t);
        return {
          value: String(value),
          label: value === defaultValue ? t(`${PREFIX}.defaultValue`, { value: text }) : text,
        };
      }),
    [current, defaultValue, field, t],
  );
  const select = useCallback(
    (value: string) => void save({ [configKey]: Number(value) }),
    [configKey, save],
  );
  return (
    <DimWhen dimmed={chrome.dimmed}>
      <SettingsSelect
        label={chrome.label}
        labelAccessory={chrome.infoTip}
        hint={chrome.hint}
        value={String(current)}
        options={options}
        onValueChange={select}
        disabled={chrome.locked}
        testID={`voice-settings-tuning-${field}`}
      />
    </DimWhen>
  );
}

function PromptRow({
  status,
  tuning,
  speech,
  save,
}: {
  status: SpeechLocalStatus;
  tuning: DictationTuningStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const chrome = useRowChrome(status, tuning, "prompt");
  const builtIn = tuning.defaults.prompt;
  const custom = speech.dictationPrompt?.trim() ?? "";
  const current = custom || builtIn;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [draftKey, setDraftKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const header = useMemo<SheetHeader>(() => ({ title: chrome.label }), [chrome.label]);

  const open = useCallback(() => {
    setDraft(current);
    setDraftKey((key) => key + 1);
    setEditing(true);
  }, [current]);
  const close = useCallback(() => {
    if (!saving) setEditing(false);
  }, [saving]);
  const restoreBuiltIn = useCallback(() => {
    setDraft(builtIn);
    setDraftKey((key) => key + 1);
  }, [builtIn]);
  const submit = useCallback(() => {
    const text = draft.trim();
    setSaving(true);
    void save({ dictationPrompt: text === builtIn ? "" : text }).finally(() => {
      setSaving(false);
      setEditing(false);
    });
  }, [builtIn, draft, save]);

  const summary = custom ? t(`${PREFIX}.prompt.custom`) : t(`${PREFIX}.prompt.builtIn`);
  return (
    <DimWhen dimmed={chrome.dimmed}>
      <SettingsRow
        label={chrome.label}
        labelAccessory={chrome.infoTip}
        hint={chrome.hint ?? summary}
      >
        <Button
          variant="outline"
          size="sm"
          onPress={open}
          disabled={chrome.locked}
          testID="voice-settings-tuning-prompt"
        >
          {t("settings.voiceSettings.instructions.edit")}
        </Button>
      </SettingsRow>
      {editing ? (
        <AdaptiveModalSheet header={header} visible onClose={close} desktopMaxWidth={640}>
          <SettingsTextAreaCard
            key={draftKey}
            accessibilityLabel={chrome.label}
            value={draft}
            onChangeText={setDraft}
            style={styles.promptInput}
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
    </DimWhen>
  );
}

const styles = StyleSheet.create((theme) => ({
  dimmed: {
    opacity: theme.opacity[50],
  },
  promptInput: {
    minHeight: 160,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
