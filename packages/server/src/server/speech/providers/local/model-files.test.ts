import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  countKokoroVoices,
  detectLocalSpeechModelKind,
  kokoroLexiconFor,
  LocalSpeechModelFolderError,
  resolveSttModelFiles,
  resolveTtsModelFiles,
} from "./model-files.js";

const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(files: string[], options: { voices?: number; styleLength?: number } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-model-"));
  directories.push(dir);
  for (const name of files) {
    if (name.endsWith("/")) mkdirSync(path.join(dir, name));
    else writeFileSync(path.join(dir, name), "");
  }
  if (options.voices) {
    writeFileSync(
      path.join(dir, "voices.bin"),
      Buffer.alloc(options.voices * (options.styleLength ?? 511) * 256 * 4),
    );
  }
  return dir;
}

describe("local speech model folders", () => {
  it("prefers int8 on the CPU and the CUDA-patched encoder on the GPU", () => {
    const dir = folder([
      "encoder.int8.onnx",
      "encoder.fp16.onnx",
      "encoder.fp16-cuda.onnx",
      "decoder.int8.onnx",
      "decoder.fp16.onnx",
      "joiner.int8.onnx",
      "joiner.fp16.onnx",
      "tokens.txt",
    ]);

    expect(path.basename(resolveSttModelFiles(dir, "cpu").encoder)).toBe("encoder.int8.onnx");
    const cuda = resolveSttModelFiles(dir, "cuda");
    expect(path.basename(cuda.encoder)).toBe("encoder.fp16-cuda.onnx");
    expect(path.basename(cuda.decoder)).toBe("decoder.fp16.onnx");
  });

  it("tells recognition and synthesis folders apart, and rejects anything else", () => {
    const stt = folder(["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"]);
    const tts = folder(["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data/"]);
    const other = folder(["readme.md"]);

    expect(detectLocalSpeechModelKind(stt)).toBe("stt");
    expect(detectLocalSpeechModelKind(tts)).toBe("tts");
    expect(() => detectLocalSpeechModelKind(other)).toThrow(LocalSpeechModelFolderError);
    expect(() => detectLocalSpeechModelKind(path.join(other, "missing"))).toThrow(
      /Folder not found/,
    );
  });

  it("counts Kokoro voices and recognizes the multi-language format", () => {
    const english = folder(["model.onnx", "tokens.txt", "espeak-ng-data/"], { voices: 11 });
    const multi = folder(["model.onnx", "tokens.txt", "espeak-ng-data/"], {
      voices: 54,
      styleLength: 510,
    });

    expect(countKokoroVoices(english)).toEqual({ count: 11, styleLength: 511 });
    expect(resolveTtsModelFiles(english).multiLanguage).toBe(false);
    expect(countKokoroVoices(multi)).toEqual({ count: 54, styleLength: 510 });
    expect(resolveTtsModelFiles(multi).multiLanguage).toBe(true);
  });

  it("passes lexicons for English and Chinese voices and none for other languages", () => {
    const dir = folder([
      "model.onnx",
      "voices.bin",
      "tokens.txt",
      "espeak-ng-data/",
      "lexicon-us-en.txt",
      "lexicon-gb-en.txt",
      "lexicon-zh.txt",
    ]);
    const files = resolveTtsModelFiles(dir);
    const names = (lexicon: string | null) =>
      lexicon?.split(",").map((file) => path.basename(file));

    expect(names(kokoroLexiconFor(files, "en-us"))).toEqual([
      "lexicon-us-en.txt",
      "lexicon-zh.txt",
    ]);
    expect(names(kokoroLexiconFor(files, "en-gb"))).toEqual([
      "lexicon-gb-en.txt",
      "lexicon-zh.txt",
    ]);
    expect(kokoroLexiconFor(files, "pt-br")).toBeNull();
  });
});
