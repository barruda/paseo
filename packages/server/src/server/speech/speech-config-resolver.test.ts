import path from "node:path";

import { describe, expect, test } from "vitest";

import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveSpeechConfig } from "./speech-config-resolver.js";

describe("resolveSpeechConfig", () => {
  test("resolves local-first defaults without env overrides", () => {
    const paseoHome = "/tmp/paseo-home";
    const persisted = PersistedConfigSchema.parse({});
    const env = { PASEO_LOCAL_SPEECH_CUDA_DIR: "/opt/paseo-cuda/lib" } as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      paseoHome,
      env,
      persisted,
    });

    expect(result.openai).toBeUndefined();
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.local).toEqual({
      modelsDir: path.join(paseoHome, "models", "local-speech"),
      executionProvider: "cpu",
      cudaLibDir: "/opt/paseo-cuda/lib",
      customModels: [],
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 0,
      },
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(0);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "en",
      voice: "en",
    });
  });

  test("resolves feature-scoped local speech settings", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        voiceMode: {
          turnDetection: { provider: "local" },
          stt: { provider: "openai", model: "gpt-4o-transcribe" },
        },
      },
      providers: {
        openai: { apiKey: "persisted-key" },
      },
    });
    const env = {
      PASEO_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      PASEO_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      PASEO_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
      PASEO_VOICE_LOCAL_TTS_SPEAKER_ID: "5",
      PASEO_VOICE_LOCAL_TTS_SPEED: "1.35",
      PASEO_DICTATION_LANGUAGE: "es",
      PASEO_VOICE_LANGUAGE: "pt",
      PASEO_LOCAL_MODELS_DIR: "/tmp/models",
      OPENAI_API_KEY: "env-key",
      PASEO_VOICE_STT_PROVIDER: "openai",
      PASEO_DICTATION_STT_PROVIDER: "local",
      PASEO_VOICE_TTS_PROVIDER: "local",
    } as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      paseoHome: "/tmp/paseo-home",
      env,
      persisted,
    });

    expect(result.speech.local).toMatchObject({
      modelsDir: "/tmp/models",
      executionProvider: "cpu",
      customModels: [],
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 5,
        voiceTtsSpeed: 1.35,
      },
    });
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "openai",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(5);
    expect(result.speech.local?.models.voiceTtsSpeed).toBe(1.35);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "pt",
    });
    expect(result.openai?.stt?.apiKey).toBe("persisted-key");
    expect(result.openai?.tts?.apiKey).toBe("persisted-key");
    expect(result.openai?.stt?.model).toBe("gpt-4o-transcribe");
  });

  test("resolves STT language from env, settings, and voice-to-dictation fallback", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: {
          stt: {
            language: "fr",
          },
        },
        voiceMode: {
          stt: {
            language: "de",
          },
        },
      },
    });

    const result = resolveSpeechConfig({
      paseoHome: "/tmp/paseo-home",
      env: {
        PASEO_DICTATION_LANGUAGE: "es",
        PASEO_VOICE_LANGUAGE: "  ",
      } as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "es",
    });
  });

  test("respects disabled dictation and voice mode feature flags", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    });

    const result = resolveSpeechConfig({
      paseoHome: "/tmp/paseo-home",
      env: {} as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
  });

  // CUSTOM(voice-settings)
  test("resolves Settings choices: GPU, folders registered as models, and instructions", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: { stt: { provider: "local", model: "custom-my-parakeet-abc123" } },
        voiceMode: {
          tts: { provider: "local", model: "kokoro-multi-lang-v1_0", speakerId: 42 },
          instructions: "  Answer in Portuguese.  ",
        },
      },
      providers: {
        local: {
          executionProvider: "cuda",
          customModels: [
            { id: "custom-my-parakeet-abc123", kind: "stt", path: "/models/my-parakeet" },
          ],
        },
      },
    });

    const result = resolveSpeechConfig({ paseoHome: "/tmp/paseo-home", env: {}, persisted });

    expect(result.speech.local?.executionProvider).toBe("cuda");
    expect(result.speech.local?.models.dictationStt).toBe("custom-my-parakeet-abc123");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-multi-lang-v1_0");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(42);
    expect(result.speech.voiceInstructions).toBe("Answer in Portuguese.");
  });

  test("rejects a model that is neither in the catalog nor registered", () => {
    const persisted = PersistedConfigSchema.parse({
      features: { voiceMode: { stt: { provider: "local", model: "custom-gone-123456" } } },
    });

    expect(() => resolveSpeechConfig({ paseoHome: "/tmp/paseo-home", env: {}, persisted })).toThrow(
      /Unknown local speech recognition model: custom-gone-123456/,
    );
  });

  test("does not accept a synthesis folder as a recognition model", () => {
    const persisted = PersistedConfigSchema.parse({
      features: { dictation: { stt: { provider: "local", model: "custom-voice-1" } } },
      providers: {
        local: { customModels: [{ id: "custom-voice-1", kind: "tts", path: "/models/voice" }] },
      },
    });

    expect(() => resolveSpeechConfig({ paseoHome: "/tmp/paseo-home", env: {}, persisted })).toThrow(
      /Unknown local speech recognition model/,
    );
  });
});
