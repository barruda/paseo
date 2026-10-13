// CUSTOM(voice-settings): pure helpers behind Settings > Voice and dictation.
import type { SpeechLocalStatus, SpeechModelInfo } from "@getpaseo/protocol/speech-settings";

export type SpeechModelKind = SpeechModelInfo["kind"];

export type EngineState =
  | { kind: "unavailable"; message: string }
  | { kind: "downloading"; modelIds: string[] }
  | { kind: "running"; provider: "cpu" | "cuda" }
  | { kind: "idle"; provider: "cpu" | "cuda" };

export function deriveEngineState(status: SpeechLocalStatus): EngineState {
  if (status.readiness.downloadInProgress) {
    return { kind: "downloading", modelIds: status.readiness.downloadModelIds };
  }
  const { dictation, voice } = status.readiness;
  if (!dictation.available && !voice.available) {
    return { kind: "unavailable", message: status.readiness.downloadError ?? voice.message };
  }
  return status.worker.running
    ? { kind: "running", provider: status.engine.effectiveProvider }
    : { kind: "idle", provider: status.engine.effectiveProvider };
}

export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function modelsOfKind(
  models: readonly SpeechModelInfo[],
  kind: SpeechModelKind,
): SpeechModelInfo[] {
  return models.filter((model) => model.kind === kind);
}

export function findModel(
  models: readonly SpeechModelInfo[],
  id: string | undefined,
): SpeechModelInfo | null {
  return models.find((model) => model.id === id) ?? null;
}

// Kokoro voice names read <language><gender>_<name>, e.g. "pf_dora".
export type VoiceLanguage =
  | "enUS"
  | "enGB"
  | "es"
  | "fr"
  | "hi"
  | "it"
  | "ja"
  | "ptBR"
  | "zh"
  | "unknown";

const LANGUAGE_BY_PREFIX: Record<string, VoiceLanguage> = {
  a: "enUS",
  b: "enGB",
  e: "es",
  f: "fr",
  h: "hi",
  i: "it",
  j: "ja",
  p: "ptBR",
  z: "zh",
};

export interface SpeakerInfo {
  id: number;
  name: string;
  language: VoiceLanguage;
  gender: "female" | "male" | null;
}

export function describeSpeaker(name: string, id: number): SpeakerInfo {
  const match = /^([a-z])([fm])_(.+)$/.exec(name);
  if (!match) {
    return { id, name, language: "unknown", gender: null };
  }
  const [, language, gender, rest] = match;
  return {
    id,
    name: rest.charAt(0).toUpperCase() + rest.slice(1),
    language: LANGUAGE_BY_PREFIX[language] ?? "unknown",
    gender: gender === "f" ? "female" : "male",
  };
}

export const SPEED_VALUES = [0.85, 1, 1.15, 1.3] as const;

export function nearestSpeed(speed: number | undefined): (typeof SPEED_VALUES)[number] {
  const value = speed ?? 1;
  return SPEED_VALUES.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}

export type SettingField =
  | "dictationSttModel"
  | "voiceSttModel"
  | "voiceTtsModel"
  | "voiceTtsSpeakerId"
  | "voiceTtsSpeed"
  | "modelsDir";

export function isEnvControlled(status: SpeechLocalStatus | null, field: SettingField): boolean {
  return status?.envControlled.includes(field) ?? false;
}

// A host's own models, the catalog after the installed ones, then folders the user added.
export function sortModels(models: readonly SpeechModelInfo[]): SpeechModelInfo[] {
  const rank = (model: SpeechModelInfo) => {
    if (model.source === "custom") return 2;
    return model.installed ? 0 : 1;
  };
  return [...models].sort((a, b) => rank(a) - rank(b));
}

// The sample a voice reads when previewed, in the voice's own language.
const PREVIEW_TEXT: Partial<Record<VoiceLanguage, string>> = {
  enUS: "Hi! This is how I will sound in voice mode.",
  enGB: "Hello! This is how I will sound in voice mode.",
  ptBR: "Olá! É assim que eu vou soar no modo de voz.",
  es: "¡Hola! Así es como sonaré en el modo de voz.",
  fr: "Bonjour ! Voici comment je sonnerai en mode vocal.",
  it: "Ciao! Ecco come suonerò in modalità vocale.",
  ja: "こんにちは。音声モードではこのように話します。",
  zh: "你好！这是我在语音模式下的声音。",
  hi: "नमस्ते! वॉइस मोड में मैं ऐसा सुनाई दूँगा।",
};

export function previewTextFor(language: VoiceLanguage): string {
  return PREVIEW_TEXT[language] ?? PREVIEW_TEXT.enUS!;
}

export function pcmMimeType(format: string): string {
  const rate = /rate=(\d+)/.exec(format)?.[1] ?? "24000";
  return `audio/pcm;rate=${rate};bits=16`;
}

export type ModelAvailability = "installed" | "download" | "customFolder" | "folderMissing";

export function modelAvailability(model: SpeechModelInfo): ModelAvailability {
  if (model.source === "custom") return model.installed ? "customFolder" : "folderMissing";
  return model.installed ? "installed" : "download";
}

export interface EngineBadge {
  labelKey: "running" | "idle" | "downloading" | "unavailable";
  hintKey: "runningHint" | "idleHint" | null;
  variant: "success" | "warning" | "error" | "muted";
  provider: "cpu" | "cuda" | null;
}

export function engineBadge(engine: EngineState): EngineBadge {
  switch (engine.kind) {
    case "running":
      return {
        labelKey: "running",
        hintKey: "runningHint",
        variant: "success",
        provider: engine.provider,
      };
    case "idle":
      return { labelKey: "idle", hintKey: "idleHint", variant: "muted", provider: engine.provider };
    case "downloading":
      return { labelKey: "downloading", hintKey: null, variant: "warning", provider: null };
    case "unavailable":
      return { labelKey: "unavailable", hintKey: null, variant: "error", provider: null };
  }
}
