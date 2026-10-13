// CUSTOM(voice-settings): find the files of a local speech model by looking at its folder,
// so catalog downloads and folders the user registers from Settings load the same way.
// Recognition models are NeMo transducers (encoder/decoder/joiner + tokens.txt); synthesis
// models are Kokoro (model.onnx + voices.bin + tokens.txt + espeak-ng-data).
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { LocalSpeechExecutionProvider } from "./local-speech-gpu.js";

export type LocalSpeechModelKind = "stt" | "tts";

export interface SttModelFiles {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

export interface TtsModelFiles {
  model: string;
  voices: string;
  tokens: string;
  dataDir: string;
  // Multi-language Kokoro (v1.0+) aborts the process without a lexicon or a language.
  lexicons: string[];
  multiLanguage: boolean;
}

// No parameter properties: the worker loads this file with Node's strip-only TypeScript.
export class LocalSpeechModelFolderError extends Error {
  readonly folder: string;

  constructor(folder: string, message: string) {
    super(message);
    this.name = "LocalSpeechModelFolderError";
    this.folder = folder;
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    throw new LocalSpeechModelFolderError(dir, `Folder not found: ${dir}`);
  }
}

// Variant order when a folder ships several precisions of the same part. int8 has no CUDA
// kernels, so CUDA prefers the patched and full-precision files; the CPU prefers int8.
const CPU_VARIANTS = [".int8.onnx", ".onnx", ".fp16.onnx"];
const CUDA_VARIANTS = [".fp16-cuda.onnx", ".onnx", ".fp16.onnx", ".int8.onnx"];

function pickVariant(
  files: readonly string[],
  part: string,
  provider: LocalSpeechExecutionProvider,
): string | null {
  const variants = provider === "cuda" ? CUDA_VARIANTS : CPU_VARIANTS;
  for (const suffix of variants) {
    const name = `${part}${suffix}`;
    if (files.includes(name)) {
      return name;
    }
  }
  return files.find((name) => name.startsWith(`${part}`) && name.endsWith(".onnx")) ?? null;
}

export function resolveSttModelFiles(
  dir: string,
  provider: LocalSpeechExecutionProvider,
): SttModelFiles {
  const files = listFiles(dir);
  const encoder = pickVariant(files, "encoder", provider);
  const decoder = pickVariant(files, "decoder", provider);
  const joiner = pickVariant(files, "joiner", provider);
  if (!encoder || !decoder || !joiner || !files.includes("tokens.txt")) {
    throw new LocalSpeechModelFolderError(
      dir,
      "Not a speech recognition model: expected encoder, decoder and joiner .onnx files and tokens.txt (NeMo transducer, such as Parakeet).",
    );
  }
  return {
    encoder: path.join(dir, encoder),
    decoder: path.join(dir, decoder),
    joiner: path.join(dir, joiner),
    tokens: path.join(dir, "tokens.txt"),
  };
}

export function resolveTtsModelFiles(dir: string): TtsModelFiles {
  const files = listFiles(dir);
  const model = files.includes("model.onnx")
    ? "model.onnx"
    : files.find((name) => name.startsWith("model") && name.endsWith(".onnx"));
  const dataDir = path.join(dir, "espeak-ng-data");
  if (
    !model ||
    !files.includes("voices.bin") ||
    !files.includes("tokens.txt") ||
    !existsSync(dataDir)
  ) {
    throw new LocalSpeechModelFolderError(
      dir,
      "Not a speech synthesis model: expected model.onnx, voices.bin, tokens.txt and espeak-ng-data (Kokoro).",
    );
  }
  const lexicons = files.filter((name) => /^lexicon-.*\.txt$/.test(name)).sort();
  return {
    model: path.join(dir, model),
    voices: path.join(dir, "voices.bin"),
    tokens: path.join(dir, "tokens.txt"),
    dataDir,
    lexicons: lexicons.map((name) => path.join(dir, name)),
    multiLanguage: lexicons.length > 0 || countKokoroVoices(dir).styleLength === 510,
  };
}

export function detectLocalSpeechModelKind(dir: string): LocalSpeechModelKind {
  const errors: string[] = [];
  try {
    resolveTtsModelFiles(dir);
    return "tts";
  } catch (error) {
    if (!(error instanceof LocalSpeechModelFolderError)) throw error;
    errors.push(error.message);
  }
  try {
    resolveSttModelFiles(dir, "cpu");
    return "stt";
  } catch (error) {
    if (!(error instanceof LocalSpeechModelFolderError)) throw error;
    errors.push(error.message);
  }
  throw new LocalSpeechModelFolderError(dir, errors.join(" "));
}

// Kokoro voices.bin is a float32 table of N voices x styleLength x 256. v0.19 uses 511
// style rows, v1.0+ uses 510; the file size tells them apart.
export function countKokoroVoices(dir: string): { count: number; styleLength: number | null } {
  let size: number;
  try {
    size = statSync(path.join(dir, "voices.bin")).size;
  } catch {
    return { count: 0, styleLength: null };
  }
  for (const styleLength of [510, 511]) {
    const bytesPerVoice = styleLength * 256 * 4;
    if (size > 0 && size % bytesPerVoice === 0) {
      return { count: size / bytesPerVoice, styleLength };
    }
  }
  return { count: 0, styleLength: null };
}

export function folderSizeBytes(dir: string): number {
  let total = 0;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  }
  return total;
}

// Lexicons cover English and Chinese only; other languages go through espeak-ng by `lang`.
export function kokoroLexiconFor(files: TtsModelFiles, language: string): string | null {
  const english = language === "en-gb" ? "gb-en" : "us-en";
  const wanted = language.startsWith("en") || language === "cmn" ? [english, "-zh."] : [];
  const picked = files.lexicons.filter((file) =>
    wanted.some((part) => path.basename(file).includes(part)),
  );
  return picked.length > 0 ? picked.join(",") : null;
}
