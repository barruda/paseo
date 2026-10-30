import path from "node:path";

import { z } from "zod";

import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
} from "./models.js";
import { resolveCudaLibDir, type LocalSpeechExecutionProvider } from "./local-speech-gpu.js";

// CUSTOM(voice-settings): model ids are catalog ids or ids of folders registered in
// Settings (providers.local.customModels), so they are plain strings here.
export interface LocalSpeechModelConfig {
  dictationStt: string;
  voiceStt: string;
  voiceTts: string;
  voiceTtsSpeakerId?: number;
  voiceTtsSpeed?: number;
}

export interface LocalSpeechCustomModel {
  id: string;
  kind: "stt" | "tts";
  path: string;
  label?: string;
}

export interface LocalSpeechProviderConfig {
  modelsDir: string;
  models: LocalSpeechModelConfig;
  // CUSTOM(voice-settings)
  executionProvider: LocalSpeechExecutionProvider;
  cudaLibDir: string;
  customModels: LocalSpeechCustomModel[];
}

export interface ResolvedLocalSpeechConfig {
  local: LocalSpeechProviderConfig | undefined;
  modelsDir: string;
  sttLanguages: LocalSpeechSttLanguageConfig;
}

export type { LocalSpeechModelId, LocalSttModelId, LocalTtsModelId };

const DEFAULT_LOCAL_MODELS_SUBDIR = path.join("models", "local-speech");
const DEFAULT_STT_LANGUAGE = "en";

export interface LocalSpeechSttLanguageConfig {
  dictation: string;
  voice: string;
}

const NumberLikeSchema = z.union([z.number(), z.string().trim().min(1)]);
const LanguageSchema = z.string().trim().min(1).default(DEFAULT_STT_LANGUAGE);

const OptionalFiniteNumberSchema = NumberLikeSchema.pipe(
  z.coerce.number<string | number>().finite(),
).optional();

const OptionalIntegerSchema = NumberLikeSchema.pipe(
  z.coerce.number<string | number>().int(),
).optional();

const LocalSpeechResolutionSchema = z.object({
  includeProviderConfig: z.boolean(),
  modelsDir: z.string().trim().min(1),
  // CUSTOM(voice-settings): checked against the catalog and custom models after parsing.
  dictationLocalSttModel: z.string().trim().toLowerCase().default(DEFAULT_LOCAL_STT_MODEL),
  voiceLocalSttModel: z.string().trim().toLowerCase().default(DEFAULT_LOCAL_STT_MODEL),
  voiceLocalTtsModel: z.string().trim().toLowerCase().default(DEFAULT_LOCAL_TTS_MODEL),
  dictationLanguage: LanguageSchema,
  voiceLanguage: LanguageSchema,
  voiceLocalTtsSpeakerId: OptionalIntegerSchema,
  voiceLocalTtsSpeed: OptionalFiniteNumberSchema,
});

function persistedLocalFeatureModel(
  provider: RequestedSpeechProviders[keyof RequestedSpeechProviders]["provider"],
  enabled: boolean | undefined,
  site: { provider: string; model?: string } | undefined,
): string | undefined {
  if (provider !== "local" || enabled === false) {
    return undefined;
  }
  return site?.provider === "local" ? site.model : undefined;
}

function shouldIncludeLocalProviderConfig(params: {
  providers: RequestedSpeechProviders;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): boolean {
  const localRequestedByFeature =
    (params.providers.dictationStt.enabled !== false &&
      params.providers.dictationStt.provider === "local") ||
    (params.providers.voiceStt.enabled !== false &&
      params.providers.voiceStt.provider === "local") ||
    (params.providers.voiceTts.enabled !== false && params.providers.voiceTts.provider === "local");

  return (
    localRequestedByFeature ||
    params.env.PASEO_LOCAL_MODELS_DIR !== undefined ||
    params.persisted.providers?.local?.modelsDir !== undefined
  );
}

function firstDefinedValue<T>(values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function firstNonEmptyString(values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function buildLocalSpeechLanguageResolutionInput(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): Record<string, unknown> {
  const { env, persisted } = params;
  return {
    dictationLanguage: firstNonEmptyString([
      env.PASEO_DICTATION_LANGUAGE,
      persisted.features?.dictation?.stt?.language,
      DEFAULT_STT_LANGUAGE,
    ]),
    voiceLanguage: firstNonEmptyString([
      env.PASEO_VOICE_LANGUAGE,
      env.PASEO_DICTATION_LANGUAGE,
      persisted.features?.voiceMode?.stt?.language,
      persisted.features?.dictation?.stt?.language,
      DEFAULT_STT_LANGUAGE,
    ]),
  };
}

function buildLocalSpeechResolutionInput(params: {
  paseoHome: string;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
  includeProviderConfig: boolean;
}): Record<string, unknown> {
  const { paseoHome, env, persisted, providers, includeProviderConfig } = params;
  const tts = persisted.features?.voiceMode?.tts;
  const localTts = tts?.provider === "local" ? tts : undefined;
  return {
    includeProviderConfig,
    modelsDir: firstDefinedValue<string>([
      env.PASEO_LOCAL_MODELS_DIR,
      persisted.providers?.local?.modelsDir,
      path.join(paseoHome, DEFAULT_LOCAL_MODELS_SUBDIR),
    ]),
    dictationLocalSttModel: firstDefinedValue<string>([
      env.PASEO_DICTATION_LOCAL_STT_MODEL,
      persistedLocalFeatureModel(
        providers.dictationStt.provider,
        providers.dictationStt.enabled,
        persisted.features?.dictation?.stt,
      ),
      DEFAULT_LOCAL_STT_MODEL,
    ]),
    voiceLocalSttModel: firstDefinedValue<string>([
      env.PASEO_VOICE_LOCAL_STT_MODEL,
      persistedLocalFeatureModel(
        providers.voiceStt.provider,
        providers.voiceStt.enabled,
        persisted.features?.voiceMode?.stt,
      ),
      DEFAULT_LOCAL_STT_MODEL,
    ]),
    voiceLocalTtsModel: firstDefinedValue<string>([
      env.PASEO_VOICE_LOCAL_TTS_MODEL,
      persistedLocalFeatureModel(
        providers.voiceTts.provider,
        providers.voiceTts.enabled,
        persisted.features?.voiceMode?.tts,
      ),
      DEFAULT_LOCAL_TTS_MODEL,
    ]),
    ...buildLocalSpeechLanguageResolutionInput({ env, persisted }),
    voiceLocalTtsSpeakerId: firstDefinedValue<string | number>([
      env.PASEO_VOICE_LOCAL_TTS_SPEAKER_ID,
      localTts?.speakerId,
    ]),
    voiceLocalTtsSpeed: firstDefinedValue<string | number>([
      env.PASEO_VOICE_LOCAL_TTS_SPEED,
      localTts?.speed,
    ]),
  };
}

export class UnknownLocalSpeechModelError extends Error {
  readonly modelId: string;
  readonly kind: "stt" | "tts";

  constructor(modelId: string, kind: "stt" | "tts") {
    super(
      `Unknown local ${kind === "stt" ? "speech recognition" : "speech synthesis"} model: ${modelId}`,
    );
    this.name = "UnknownLocalSpeechModelError";
    this.modelId = modelId;
    this.kind = kind;
  }
}

function assertLocalModelRef(
  id: string,
  kind: "stt" | "tts",
  customModels: readonly LocalSpeechCustomModel[],
): string {
  const catalog = kind === "stt" ? LocalSttModelIdSchema : LocalTtsModelIdSchema;
  if (catalog.safeParse(id).success) return id;
  if (customModels.some((model) => model.id === id && model.kind === kind)) return id;
  throw new UnknownLocalSpeechModelError(id, kind);
}

export function resolveLocalSpeechConfig(params: {
  paseoHome: string;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): ResolvedLocalSpeechConfig {
  const includeProviderConfig = shouldIncludeLocalProviderConfig(params);
  const parsed = LocalSpeechResolutionSchema.parse(
    buildLocalSpeechResolutionInput({ ...params, includeProviderConfig }),
  );

  const resolvedVoiceTtsSpeakerId = parsed.voiceLocalTtsSpeakerId ?? 0;
  // CUSTOM(voice-settings)
  const localPersisted = params.persisted.providers?.local;
  const customModels = (localPersisted?.customModels ?? []).map(
    (model): LocalSpeechCustomModel =>
      Object.assign({}, model, { id: model.id.trim().toLowerCase() }),
  );
  const dictationStt = assertLocalModelRef(parsed.dictationLocalSttModel, "stt", customModels);
  const voiceStt = assertLocalModelRef(parsed.voiceLocalSttModel, "stt", customModels);
  const voiceTts = assertLocalModelRef(parsed.voiceLocalTtsModel, "tts", customModels);

  return {
    modelsDir: parsed.modelsDir,
    sttLanguages: {
      dictation: parsed.dictationLanguage,
      voice: parsed.voiceLanguage,
    },
    local: parsed.includeProviderConfig
      ? {
          modelsDir: parsed.modelsDir,
          executionProvider: localPersisted?.executionProvider ?? "cpu",
          cudaLibDir: resolveCudaLibDir(params.env, localPersisted?.cudaLibDir),
          customModels,
          models: {
            dictationStt,
            voiceStt,
            voiceTts,
            ...(resolvedVoiceTtsSpeakerId !== undefined
              ? { voiceTtsSpeakerId: resolvedVoiceTtsSpeakerId }
              : {}),
            ...(parsed.voiceLocalTtsSpeed !== undefined
              ? { voiceTtsSpeed: parsed.voiceLocalTtsSpeed }
              : {}),
          },
        }
      : undefined,
  };
}
