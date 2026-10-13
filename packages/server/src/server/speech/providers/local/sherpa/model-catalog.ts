import { z } from "zod";

export type SherpaOnnxModelKind = "stt-offline" | "tts";

type DefaultModelRole = "stt" | "tts";

interface SherpaOnnxCatalogEntry {
  kind: SherpaOnnxModelKind;
  archiveUrl: string;
  extractedDir: string;
  requiredFiles: string[];
  description: string;
  defaultFor?: DefaultModelRole;
  // CUSTOM(voice-settings): what Settings shows in the model and voice pickers.
  label: string;
  languages: string;
  downloadSizeMb: number;
  speakers?: readonly string[];
}

// CUSTOM(voice-settings): Kokoro voice names, by speaker id.
const KOKORO_V0_19_SPEAKERS = [
  "af",
  "af_bella",
  "af_nicole",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_michael",
  "bf_emma",
  "bf_isabella",
  "bm_george",
  "bm_lewis",
] as const;

const KOKORO_V1_0_SPEAKERS = [
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis",
  "ef_dora",
  "em_alex",
  "ff_siwis",
  "hf_alpha",
  "hf_beta",
  "hm_omega",
  "hm_psi",
  "if_sara",
  "im_nicola",
  "jf_alpha",
  "jf_gongitsune",
  "jf_nezumi",
  "jf_tebukuro",
  "jm_kumo",
  "pf_dora",
  "pm_alex",
  "pm_santa",
  "zf_xiaobei",
  "zf_xiaoni",
  "zf_xiaoxiao",
  "zf_xiaoyi",
  "zm_yunjian",
  "zm_yunxi",
  "zm_yunxia",
  "zm_yunyang",
  "em_santa",
] as const;

// The first letter of a Kokoro voice name is its language; multi-language Kokoro needs the
// matching espeak-ng language to pronounce anything but English.
const KOKORO_LANGUAGE_BY_PREFIX: Record<string, string> = {
  a: "en-us",
  b: "en-gb",
  e: "es",
  f: "fr-fr",
  h: "hi",
  i: "it",
  j: "ja",
  p: "pt-br",
  z: "cmn",
};

export function kokoroLanguageForSpeaker(name: string | undefined): string {
  return KOKORO_LANGUAGE_BY_PREFIX[name?.charAt(0) ?? "a"] ?? "en-us";
}

export const SHERPA_ONNX_MODEL_CATALOG = {
  "parakeet-tdt-0.6b-v2-int8": {
    kind: "stt-offline",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).",
    defaultFor: "stt",
    label: "Parakeet v2 (int8)",
    languages: "English",
    downloadSizeMb: 482,
  },
  "parakeet-tdt-0.6b-v3-int8": {
    kind: "stt-offline",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
    description:
      "NVIDIA Parakeet TDT v3 (offline NeMo transducer, 25 European languages, auto-detected).",
    label: "Parakeet v3 (int8)",
    languages: "25 European languages, including Portuguese",
    downloadSizeMb: 487,
  },
  // CUSTOM(local-speech-gpu): full-precision Parakeet for the CUDA provider. int8 kernels
  // have no CUDA implementation, so the int8 models stay on the CPU even under CUDA.
  // Needs ~5.5 GB of RAM on the CPU; use it with PASEO_LOCAL_SPEECH_CUDA_DIR.
  "parakeet-tdt-0.6b-v2-fp16": {
    kind: "stt-offline",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-fp16.tar.bz2",
    extractedDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-fp16",
    requiredFiles: ["encoder.fp16.onnx", "decoder.fp16.onnx", "joiner.fp16.onnx", "tokens.txt"],
    description: "NVIDIA Parakeet TDT v2, fp16 (offline NeMo transducer, English, GPU).",
    label: "Parakeet v2 (fp16, GPU)",
    languages: "English",
    downloadSizeMb: 1120,
  },
  "kokoro-en-v0_19": {
    kind: "tts",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
    extractedDir: "kokoro-en-v0_19",
    requiredFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"],
    description: "Kokoro TTS (higher quality; larger).",
    defaultFor: "tts",
    label: "Kokoro v0.19",
    languages: "English",
    downloadSizeMb: 319,
    speakers: KOKORO_V0_19_SPEAKERS,
  },
  "kokoro-multi-lang-v1_0": {
    kind: "tts",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
    extractedDir: "kokoro-multi-lang-v1_0",
    requiredFiles: ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"],
    description: "Kokoro TTS v1.0 (54 voices in 9 languages).",
    label: "Kokoro v1.0 multi-language",
    languages: "English, Portuguese (Brazil), Spanish, French, Italian, Hindi, Japanese, Chinese",
    downloadSizeMb: 349,
    speakers: KOKORO_V1_0_SPEAKERS,
  },
} as const satisfies Record<string, SherpaOnnxCatalogEntry>;

export type SherpaOnnxModelId = keyof typeof SHERPA_ONNX_MODEL_CATALOG;
export type LocalSpeechModelId = SherpaOnnxModelId;

type ModelIdByKind<K extends SherpaOnnxModelKind> = {
  [Id in SherpaOnnxModelId]: (typeof SHERPA_ONNX_MODEL_CATALOG)[Id]["kind"] extends K ? Id : never;
}[SherpaOnnxModelId];

export type LocalSttModelId = ModelIdByKind<"stt-offline">;
export type LocalTtsModelId = ModelIdByKind<"tts">;

const ALL_MODEL_IDS: SherpaOnnxModelId[] = Object.keys(SHERPA_ONNX_MODEL_CATALOG).filter(
  (k): k is SherpaOnnxModelId => k in SHERPA_ONNX_MODEL_CATALOG,
);

function isLocalSttModelId(id: SherpaOnnxModelId): id is LocalSttModelId {
  return SHERPA_ONNX_MODEL_CATALOG[id].kind !== "tts";
}

function isLocalTtsModelId(id: SherpaOnnxModelId): id is LocalTtsModelId {
  return SHERPA_ONNX_MODEL_CATALOG[id].kind === "tts";
}

export const LOCAL_STT_MODEL_IDS: LocalSttModelId[] = ALL_MODEL_IDS.filter(isLocalSttModelId);

export const LOCAL_TTS_MODEL_IDS: LocalTtsModelId[] = ALL_MODEL_IDS.filter(isLocalTtsModelId);

function resolveDefaultModelId(role: "stt"): LocalSttModelId;
function resolveDefaultModelId(role: "tts"): LocalTtsModelId;
function resolveDefaultModelId(role: DefaultModelRole): SherpaOnnxModelId {
  const match = ALL_MODEL_IDS.find((id) => {
    const entry: SherpaOnnxCatalogEntry = SHERPA_ONNX_MODEL_CATALOG[id];
    return entry.defaultFor === role;
  });
  if (!match) {
    throw new Error(`No default model configured for role '${role}'`);
  }
  return match;
}

export const DEFAULT_LOCAL_STT_MODEL = resolveDefaultModelId("stt");
export const DEFAULT_LOCAL_TTS_MODEL = resolveDefaultModelId("tts");

function createModelIdSchema<T extends string>(modelIds: readonly T[]): z.ZodType<T, string> {
  const validIds = new Set<string>(modelIds);
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => validIds.has(value), {
      message: "Invalid model id",
    })
    .transform((value) => value as T);
}

export const LocalSttModelIdSchema = createModelIdSchema(LOCAL_STT_MODEL_IDS);
export const LocalTtsModelIdSchema = createModelIdSchema(LOCAL_TTS_MODEL_IDS);

export type SherpaOnnxModelSpec = SherpaOnnxCatalogEntry & {
  id: SherpaOnnxModelId;
};

export function listSherpaOnnxModels(): SherpaOnnxModelSpec[] {
  return ALL_MODEL_IDS.map((id) => Object.assign({ id }, SHERPA_ONNX_MODEL_CATALOG[id]));
}

export function getSherpaOnnxModelSpec(id: SherpaOnnxModelId): SherpaOnnxModelSpec {
  const spec = SHERPA_ONNX_MODEL_CATALOG[id];
  if (!spec) {
    throw new Error(`Unknown local speech model id: ${id}`);
  }
  return {
    id,
    ...spec,
  };
}
