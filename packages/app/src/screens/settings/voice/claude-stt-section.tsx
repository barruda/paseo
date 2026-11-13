// CUSTOM(claude-stt): Settings > Voice and Dictation > Claude: the Claude provider's login state
// and settings (language, key terms, config folder), plus the provider picker row that
// Dictation and Voice mode share.
import { useCallback, useMemo, useRef } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MutableSpeechConfig, SpeechLocalStatus } from "@getpaseo/protocol/speech-settings";

import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import {
  claudeLanguageOptions,
  claudeUsage,
  describeClaudeLogin,
  formatKeyterms,
  parseKeyterms,
  sameTerms,
  sttProviderOptionIds,
  usesClaude,
} from "./claude-stt-model";
import { isEnvControlled, type SettingField } from "./voice-settings-model";

type SaveSpeech = (patch: MutableSpeechConfig) => Promise<void>;

const PREFIX = "settings.voiceSettings.claudeStt";

const ENV_NAME: Partial<Record<SettingField, string>> = {
  dictationSttProvider: "PASEO_DICTATION_STT_PROVIDER",
  voiceSttProvider: "PASEO_VOICE_STT_PROVIDER",
  claudeSttLanguage: "PASEO_CLAUDE_STT_LANGUAGE",
  claudeSttConfigDir: "PASEO_CLAUDE_STT_CONFIG_DIR",
};

function envHint(status: SpeechLocalStatus, field: SettingField, t: TFunction): string | undefined {
  return isEnvControlled(status, field)
    ? t("settings.voiceSettings.models.envControlled", { name: ENV_NAME[field] })
    : undefined;
}

function useProviderOptions(current: string | undefined) {
  const { t } = useTranslation();
  return useMemo(
    () =>
      sttProviderOptionIds(current).map((value) => ({
        value,
        label: t(`${PREFIX}.provider.${value}`, { defaultValue: value }),
      })),
    [current, t],
  );
}

// A provider picker row for one STT feature. Shows the feature's note under the label when
// Claude is picked, so the row says where Claude's settings are.
export function SttProviderRow({
  label,
  status,
  field,
  value,
  note,
  save,
  testID,
}: {
  label: string;
  status: SpeechLocalStatus;
  field: "dictationSttProvider" | "voiceSttProvider";
  value: string;
  note: string | undefined;
  save: SaveSpeech;
  testID: string;
}) {
  const { t } = useTranslation();
  const options = useProviderOptions(value);
  const select = useCallback((next: string) => void save({ [field]: next }), [field, save]);
  return (
    <SettingsSelect
      label={label}
      hint={envHint(status, field, t) ?? (usesClaude(value) ? note : undefined)}
      value={value}
      options={options}
      onValueChange={select}
      disabled={isEnvControlled(status, field)}
      testID={testID}
    />
  );
}

export function ClaudeSttSection({
  status,
  speech,
  save,
}: {
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: SaveSpeech;
}) {
  const { t } = useTranslation();
  const languageOptions = useMemo(
    () => claudeLanguageOptions(speech.claudeSttLanguage),
    [speech.claudeSttLanguage],
  );
  const selectLanguage = useCallback(
    (value: string) => void save({ claudeSttLanguage: value }),
    [save],
  );
  const saveKeyterms = useCallback(
    (text: string) => {
      const terms = parseKeyterms(text);
      if (!sameTerms(terms, speech.claudeSttKeyterms ?? [])) {
        void save({ claudeSttKeyterms: terms });
      }
    },
    [save, speech.claudeSttKeyterms],
  );
  const saveConfigDir = useCallback(
    (text: string) => {
      const folder = text.trim();
      if (folder !== (speech.claudeSttConfigDir ?? "")) void save({ claudeSttConfigDir: folder });
    },
    [save, speech.claudeSttConfigDir],
  );

  // Daemons from before the provider choice report no provider; there is no Claude to set up.
  if (speech.dictationSttProvider === undefined) return null;

  const claude = status.claudeStt;
  const login = claude ? describeClaudeLogin(claude) : null;
  let loginHint: string | undefined;
  if (login?.kind === "signedIn") {
    loginHint = login.plan
      ? t(`${PREFIX}.signedInPlan`, { plan: login.plan, path: login.path })
      : t(`${PREFIX}.signedIn`, { path: login.path });
  }

  return (
    <SettingsSection
      title={t(`${PREFIX}.title`)}
      info={t(`${PREFIX}.info`)}
      testID="voice-settings-claude"
    >
      <SettingsCard>
        <SettingsRow
          label={t(
            `${PREFIX}.usage.${claudeUsage(speech.dictationSttProvider, speech.voiceSttProvider)}`,
          )}
          testID="voice-settings-claude-usage"
        />
        {claude ? (
          <SettingsRow
            label={t(`${PREFIX}.account`)}
            hint={loginHint}
            error={login?.kind === "error" ? login.message : null}
            testID="voice-settings-claude-account"
          />
        ) : null}
        <SettingsSelect
          label={t(`${PREFIX}.language`)}
          hint={envHint(status, "claudeSttLanguage", t) ?? t(`${PREFIX}.languageHint`)}
          value={speech.claudeSttLanguage ?? "en"}
          options={languageOptions}
          onValueChange={selectLanguage}
          disabled={isEnvControlled(status, "claudeSttLanguage")}
          testID="voice-settings-claude-language"
        />
        <BlurSavedRow
          // A saved value that changes elsewhere remounts the input with the new text.
          key={`terms:${formatKeyterms(speech.claudeSttKeyterms)}`}
          label={t(`${PREFIX}.keyterms`)}
          hint={t(`${PREFIX}.keytermsHint`)}
          initialValue={formatKeyterms(speech.claudeSttKeyterms)}
          multiline
          onCommit={saveKeyterms}
          testID="voice-settings-claude-keyterms"
        />
        <BlurSavedRow
          key={`dir:${speech.claudeSttConfigDir ?? ""}`}
          label={t(`${PREFIX}.configDir`)}
          hint={envHint(status, "claudeSttConfigDir", t) ?? t(`${PREFIX}.configDirHint`)}
          initialValue={speech.claudeSttConfigDir ?? ""}
          placeholder={claude?.configDir}
          disabled={isEnvControlled(status, "claudeSttConfigDir")}
          onCommit={saveConfigDir}
          testID="voice-settings-claude-config-dir"
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function BlurSavedRow({
  label,
  hint,
  initialValue,
  placeholder,
  multiline,
  disabled,
  onCommit,
  testID,
}: {
  label: string;
  hint: string;
  initialValue: string;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  onCommit: (text: string) => void;
  testID: string;
}) {
  const text = useRef(initialValue);
  const handleChange = useCallback((value: string) => {
    text.current = value;
  }, []);
  const handleBlur = useCallback(() => onCommit(text.current), [onCommit]);
  return (
    <SettingsRow label={label} hint={hint} testID={testID}>
      <FormTextInput
        initialValue={initialValue}
        onChangeText={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        accessibilityLabel={label}
        multiline={multiline}
        editable={!disabled}
        size="sm"
        style={styles.input}
      />
    </SettingsRow>
  );
}

const styles = StyleSheet.create(() => ({
  input: {
    minWidth: 220,
  },
}));
