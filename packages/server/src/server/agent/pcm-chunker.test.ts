import { describe, expect, it } from "vitest";

import { PcmChunker, findQuietCutOffset, parsePcmSampleRate } from "./pcm-chunker.js";

function tone(samples: number, amplitude: number): Buffer {
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buffer;
}

describe("parsePcmSampleRate", () => {
  it("reads the rate from the format and defaults to 24000", () => {
    expect(parsePcmSampleRate("pcm;rate=16000")).toBe(16000);
    expect(parsePcmSampleRate("pcm")).toBe(24000);
  });
});

describe("findQuietCutOffset", () => {
  it("cuts inside the silent region on an even offset", () => {
    // 1000 loud samples, 400 silent, 1000 loud.
    const pcm = Buffer.concat([tone(1000, 8000), tone(400, 0), tone(1000, 8000)]);
    const cut = findQuietCutOffset(pcm, pcm.length - 1, 2400 * 2, 240);
    expect(cut % 2).toBe(0);
    expect(cut).toBeGreaterThanOrEqual(1000 * 2);
    expect(cut).toBeLessThanOrEqual(1400 * 2);
  });
});

describe("PcmChunker", () => {
  it("emits a short first chunk, keeps a non-empty remainder and preserves bytes", () => {
    const input = Buffer.concat([tone(40_000, 5000), tone(2_400, 0), tone(60_001, 5000)]);
    const chunker = new PcmChunker(24000);
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < input.length; offset += 3001) {
      chunks.push(...chunker.push(input.subarray(offset, offset + 3001), 0));
    }
    const rest = chunker.flush();
    expect(rest).not.toBeNull();
    expect(rest!.length).toBeGreaterThan(0);
    chunks.push(rest!);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].length).toBeLessThanOrEqual(24000);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length % 2).toBe(0);
    }
    expect(Buffer.concat(chunks).equals(input)).toBe(true);
  });

  it("returns nothing for an empty stream", () => {
    expect(new PcmChunker().flush()).toBeNull();
  });

  it("releases buffered audio at low water so the app does not run dry", () => {
    // Measured Claude arrival: [wall ms, cumulative seconds of audio].
    const trace: Array<[number, number]> = [
      [851, 0.1],
      [981, 0.5],
      [1099, 1.0],
      [1287, 1.65],
      [2158, 1.75],
      [2416, 2.95],
      [2532, 3.7],
      [5699, 19.85],
    ];
    const bytesPerSecond = 48000;
    const input = tone(Math.round(19.85 * 24000), 4000);
    const chunker = new PcmChunker(24000);
    const chunks: Buffer[] = [];
    let fed = 0;
    let emittedBytes = 0;
    for (const [ms, seconds] of trace) {
      const end = Math.round(seconds * bytesPerSecond) & ~1;
      for (const chunk of chunker.push(input.subarray(fed, end), ms)) {
        chunks.push(chunk);
        emittedBytes += chunk.length;
      }
      fed = end;
      if (ms >= 1099 && ms <= 2416) {
        // While the app is near dry, everything that arrived is out except the 10 ms holdback.
        expect(fed - emittedBytes).toBeLessThanOrEqual(bytesPerSecond * 0.02);
      }
      if (ms === 1287) {
        expect(emittedBytes / bytesPerSecond).toBeGreaterThanOrEqual(1.5);
      }
    }
    const rest = chunker.flush();
    expect(rest?.length).toBeGreaterThan(0);
    chunks.push(rest!);
    expect(chunks.slice(0, -1).every((c) => c.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(chunks).equals(input)).toBe(true);
  });
});
