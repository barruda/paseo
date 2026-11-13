// CUSTOM(dictation-tuning): what the Dictation tuning section offers and when a row is locked.
import type {
  DictationTuningStatus,
  MutableSpeechConfig,
  SpeechLocalStatus,
} from "@getpaseo/protocol/speech-settings";

// Listed by hand: the wire schemas pass unknown keys through, so their keyof is `string`.
export type DictationTuningField =
  | "autoCommitSeconds"
  | "silencePeakThreshold"
  | "decodeIntervalMs"
  | "prompt";

export const DICTATION_TUNING_CONFIG_KEY = {
  autoCommitSeconds: "dictationAutoCommitSeconds",
  silencePeakThreshold: "dictationSilencePeakThreshold",
  decodeIntervalMs: "dictationDecodeIntervalMs",
  prompt: "dictationPrompt",
} as const satisfies Record<DictationTuningField, keyof MutableSpeechConfig>;

export type DictationTuningNumberField = Exclude<DictationTuningField, "prompt">;

export const DICTATION_TUNING_PRESETS: Record<DictationTuningNumberField, readonly number[]> = {
  autoCommitSeconds: [0, 5, 8, 10, 15, 20, 30, 60],
  silencePeakThreshold: [100, 200, 300, 500, 800, 1200, 2000],
  decodeIntervalMs: [200, 350, 500, 750, 1000, 1500, 2000],
};

/** The presets plus the current value when an env var or config.json set something else. */
export function tuningOptionValues(
  field: DictationTuningNumberField,
  current: number | undefined,
): number[] {
  const values = new Set(DICTATION_TUNING_PRESETS[field]);
  if (current !== undefined) values.add(current);
  return [...values].sort((a, b) => a - b);
}

export type DictationTuningRowState =
  | { kind: "editable" }
  | { kind: "envControlled" }
  | { kind: "unsupported" };

export function dictationTuningRowState(
  status: SpeechLocalStatus,
  tuning: DictationTuningStatus,
  field: DictationTuningField,
): DictationTuningRowState {
  if (!tuning.supported[field]) return { kind: "unsupported" };
  if (status.envControlled.includes(DICTATION_TUNING_CONFIG_KEY[field])) {
    return { kind: "envControlled" };
  }
  return { kind: "editable" };
}

/** The dictation model's name as the Models section shows it. */
export function dictationModelLabel(status: SpeechLocalStatus, tuning: DictationTuningStatus) {
  if (tuning.provider === "openai") return "OpenAI";
  if (tuning.provider === "claude") return "Claude"; // CUSTOM(claude-stt)
  const model = tuning.model ? status.models.find((entry) => entry.id === tuning.model) : undefined;
  return model?.label ?? tuning.model ?? tuning.provider;
}
