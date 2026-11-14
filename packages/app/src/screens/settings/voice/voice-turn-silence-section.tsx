// CUSTOM(voice-turn-silence): Settings > Voice and dictation > Voice mode > Listening. How long
// you stay quiet before the daemon ends your turn.
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MutableSpeechConfig, SpeechLocalStatus } from "@getpaseo/protocol/speech-settings";

import {
  SettingsCard,
  SettingsInfoTip,
  SettingsSection,
  SettingsSelect,
} from "@/components/settings";
import {
  DEFAULT_VOICE_TURN_SILENCE_MS,
  formatVoiceTurnSilence,
  voiceTurnSilenceOptionValues,
  voiceTurnSilenceRowState,
} from "./voice-turn-silence-model";

const PREFIX = "settings.voiceSettings.voiceTurnSilence";

export function VoiceTurnSilenceSection({
  status,
  speech,
  save,
}: {
  status: SpeechLocalStatus;
  speech: MutableSpeechConfig;
  save: (patch: MutableSpeechConfig) => Promise<void>;
}) {
  const { t } = useTranslation();
  const state = voiceTurnSilenceRowState(status, speech);
  const current = state.kind === "hidden" ? undefined : state.value;
  const options = useMemo(
    () =>
      voiceTurnSilenceOptionValues(current).map((value) => {
        const text = formatVoiceTurnSilence(value);
        return {
          value: String(value),
          label:
            value === DEFAULT_VOICE_TURN_SILENCE_MS
              ? t(`${PREFIX}.defaultValue`, { value: text })
              : text,
        };
      }),
    [current, t],
  );
  const select = useCallback(
    (value: string) => void save({ voiceTurnSilenceMs: Number(value) }),
    [save],
  );
  const label = t(`${PREFIX}.label`);
  const infoTip = useMemo(
    () => <SettingsInfoTip title={label} info={t(`${PREFIX}.info`)} />,
    [label, t],
  );
  // Daemons from before this setting report no value; there is nothing to show.
  if (state.kind === "hidden") return null;
  return (
    <SettingsSection title={t(`${PREFIX}.title`)} testID="voice-settings-listening">
      <SettingsCard>
        <SettingsSelect
          label={label}
          labelAccessory={infoTip}
          hint={
            state.kind === "envControlled"
              ? t("settings.voiceSettings.models.envControlled", {
                  name: "PASEO_VOICE_TURN_SILENCE_MS",
                })
              : t(`${PREFIX}.hint`)
          }
          value={String(state.value)}
          options={options}
          onValueChange={select}
          disabled={state.kind === "envControlled"}
          testID="voice-settings-turn-silence"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
