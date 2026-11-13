// CUSTOM(voice-settings): wire schemas for Settings > Voice and dictation.
//
// The editable part rides on the daemon config (`MutableDaemonConfig.speech`), so it
// persists and pushes to every client like the other host settings. The live status, voice
// preview and model-folder inspection are their own RPCs, gated on
// server_info.features.speechSettings.
import { z } from "zod";

const SpeechExecutionProviderSchema = z.enum(["cpu", "cuda"]);
const SpeechModelKindSchema = z.enum(["stt", "tts"]);

export const SpeechCustomModelSchema = z
  .object({
    id: z.string().min(1),
    kind: SpeechModelKindSchema,
    path: z.string().min(1),
    label: z.string().optional(),
  })
  .passthrough();

export const MutableSpeechConfigSchema = z
  .object({
    executionProvider: SpeechExecutionProviderSchema.optional(),
    dictationSttModel: z.string().optional(),
    voiceSttModel: z.string().optional(),
    voiceTtsModel: z.string().optional(),
    voiceTtsSpeakerId: z.number().int().optional(),
    voiceTtsSpeed: z.number().optional(),
    // Empty means the built-in instructions.
    voiceInstructions: z.string().optional(),
    customModels: z.array(SpeechCustomModelSchema).optional(),
    // CUSTOM(dictation-tuning): how dictation cuts and re-transcribes its audio. The daemon
    // reports the effective values (env var, then config, then default).
    dictationAutoCommitSeconds: z.number().min(0).optional(),
    dictationSilencePeakThreshold: z.number().int().min(0).optional(),
    dictationDecodeIntervalMs: z.number().int().min(0).optional(),
    // Empty means the built-in prompt.
    dictationPrompt: z.string().optional(),
    // CUSTOM(claude-stt): which speech-to-text provider each feature uses. Plain strings so a
    // provider added later doesn't break older clients; known values are "local", "claude"
    // and (hand-edited config) "openai".
    dictationSttProvider: z.string().optional(),
    voiceSttProvider: z.string().optional(),
    claudeSttLanguage: z.string().optional(),
    claudeSttKeyterms: z.array(z.string()).optional(),
    // Empty means the default Claude Code config folder.
    claudeSttConfigDir: z.string().optional(),
  })
  .passthrough();

const DictationTuningFieldsSchema = z
  .object({
    autoCommitSeconds: z.boolean(),
    silencePeakThreshold: z.boolean(),
    decodeIntervalMs: z.boolean(),
    prompt: z.boolean(),
  })
  .passthrough();

// CUSTOM(dictation-tuning): which tuning fields the dictation provider in use reads, and the
// values each field falls back to.
export const DictationTuningStatusSchema = z
  .object({
    provider: z.string(),
    model: z.string().nullable(),
    supported: DictationTuningFieldsSchema,
    defaults: z
      .object({
        autoCommitSeconds: z.number(),
        silencePeakThreshold: z.number(),
        decodeIntervalMs: z.number(),
        prompt: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

// CUSTOM(claude-stt)
export const ClaudeSttStatusSchema = z
  .object({
    configDir: z.string(),
    credentialsPath: z.string(),
    signedIn: z.boolean(),
    subscriptionType: z.string().nullable(),
    expiresAt: z.string().nullable(),
    error: z.string().nullable(),
  })
  .passthrough();

export const SpeechModelInfoSchema = z
  .object({
    id: z.string(),
    kind: SpeechModelKindSchema,
    label: z.string(),
    source: z.enum(["catalog", "custom"]),
    languages: z.string().nullable(),
    installed: z.boolean(),
    path: z.string().nullable(),
    sizeBytes: z.number().nullable(),
    downloadSizeMb: z.number().nullable(),
    speakers: z.array(z.string()),
  })
  .passthrough();

const SpeechFeatureReadinessSchema = z
  .object({
    available: z.boolean(),
    message: z.string(),
  })
  .passthrough();

export const SpeechLocalStatusSchema = z
  .object({
    engine: z
      .object({
        configured: z.boolean(),
        requestedProvider: SpeechExecutionProviderSchema,
        effectiveProvider: SpeechExecutionProviderSchema,
        gpuAvailable: z.boolean(),
        gpuUnavailableReason: z.string().nullable(),
        cudaLibDir: z.string(),
        modelsDir: z.string().nullable(),
      })
      .passthrough(),
    worker: z
      .object({
        running: z.boolean(),
        pid: z.number().nullable(),
        startedAt: z.string().nullable(),
        rssBytes: z.number().nullable(),
        cpuPercent: z.number().nullable(),
        vramBytes: z.number().nullable(),
        loadedModels: z.array(z.string()),
        activeSessions: z.number(),
        inFlightRequests: z.number(),
      })
      .passthrough(),
    gpuDevice: z
      .object({
        name: z.string(),
        memoryTotalBytes: z.number(),
        memoryUsedBytes: z.number(),
        utilizationPercent: z.number().nullable(),
      })
      .passthrough()
      .nullable(),
    readiness: z
      .object({
        dictation: SpeechFeatureReadinessSchema,
        voice: SpeechFeatureReadinessSchema,
        downloadInProgress: z.boolean(),
        downloadModelIds: z.array(z.string()),
        downloadError: z.string().nullable(),
      })
      .passthrough(),
    models: z.array(SpeechModelInfoSchema),
    // Settings an environment variable controls; edits to them don't take effect.
    envControlled: z.array(z.string()),
    defaultVoiceInstructions: z.string(),
    // CUSTOM(dictation-tuning): absent on daemons without the dictation tuning settings.
    dictationTuning: DictationTuningStatusSchema.optional(),
    // CUSTOM(claude-stt): the Claude login the Claude provider would use.
    claudeStt: ClaudeSttStatusSchema.optional(),
    logs: z.array(
      z
        .object({
          time: z.string(),
          level: z.string(),
          message: z.string(),
          detail: z.string().nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const SpeechLocalGetStatusRequestSchema = z.object({
  type: z.literal("speech.local.get_status.request"),
  requestId: z.string(),
  includeLogs: z.boolean().optional(),
});

export const SpeechLocalGetStatusResponseSchema = z.object({
  type: z.literal("speech.local.get_status.response"),
  payload: z
    .object({
      requestId: z.string(),
      status: SpeechLocalStatusSchema.nullable(),
      error: z.string().nullable(),
    })
    .passthrough(),
});

export const SpeechLocalPreviewVoiceRequestSchema = z.object({
  type: z.literal("speech.local.preview_voice.request"),
  requestId: z.string(),
  text: z.string(),
  model: z.string().optional(),
  speakerId: z.number().int().optional(),
  speed: z.number().optional(),
});

export const SpeechLocalPreviewVoiceResponseSchema = z.object({
  type: z.literal("speech.local.preview_voice.response"),
  payload: z
    .object({
      requestId: z.string(),
      // Base64 PCM16 mono; format reads like "pcm;rate=24000".
      audio: z.string().nullable(),
      format: z.string().nullable(),
      error: z.string().nullable(),
    })
    .passthrough(),
});

export const SpeechLocalInspectModelFolderRequestSchema = z.object({
  type: z.literal("speech.local.inspect_model_folder.request"),
  requestId: z.string(),
  path: z.string(),
});

export const SpeechLocalInspectModelFolderResponseSchema = z.object({
  type: z.literal("speech.local.inspect_model_folder.response"),
  payload: z
    .object({
      requestId: z.string(),
      model: SpeechCustomModelSchema.nullable(),
      error: z.string().nullable(),
    })
    .passthrough(),
});

export type MutableSpeechConfig = z.infer<typeof MutableSpeechConfigSchema>;
export type SpeechCustomModel = z.infer<typeof SpeechCustomModelSchema>;
export type SpeechModelInfo = z.infer<typeof SpeechModelInfoSchema>;
export type DictationTuningStatus = z.infer<typeof DictationTuningStatusSchema>;
export type ClaudeSttStatus = z.infer<typeof ClaudeSttStatusSchema>;
export type SpeechLocalStatus = z.infer<typeof SpeechLocalStatusSchema>;
export type SpeechLocalGetStatusResponse = z.infer<typeof SpeechLocalGetStatusResponseSchema>;
export type SpeechLocalPreviewVoiceResponse = z.infer<typeof SpeechLocalPreviewVoiceResponseSchema>;
export type SpeechLocalInspectModelFolderResponse = z.infer<
  typeof SpeechLocalInspectModelFolderResponseSchema
>;
