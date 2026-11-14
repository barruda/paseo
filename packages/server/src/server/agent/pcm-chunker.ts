// CUSTOM(claude-tts-whole-text): cuts a PCM16 mono stream into playable chunks at quiet points.

const BYTES_PER_SAMPLE = 2;
const DEFAULT_SAMPLE_RATE = 24_000;
const FIRST_CHUNK_SECONDS = 0.5;
const CHUNK_SECONDS = 2;
const QUIET_SEARCH_SECONDS = 0.5;
const QUIET_WINDOW_SECONDS = 0.01;
// When the app has less than this queued, release whatever is buffered (minus the holdback).
const LOW_WATER_SECONDS = 1;
// CUSTOM(claude-tts-whole-text): never release less than this at low water; tiny chunks leave
// gaps and clicks between clips. Smaller remainders wait for more audio or for flush().
const MIN_LOW_WATER_SECONDS = 0.25;
const LOW_WATER_QUIET_SEARCH_SECONDS = 0.25;
const HOLDBACK_SECONDS = 0.01;

export function parsePcmSampleRate(format: string): number {
  const match = /(?:^|;)\s*rate=(\d+)/.exec(format);
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SAMPLE_RATE;
}

/**
 * Returns the byte offset (always even) to cut at, inside the last `searchBytes` before
 * `targetBytes`: the center of the 10 ms window with the lowest mean absolute sample value.
 * Ties go to the later window so chunks stay as long as possible.
 */
export function findQuietCutOffset(
  pcm: Buffer,
  targetBytes: number,
  searchBytes: number,
  windowSamples: number,
): number {
  const target = Math.min(targetBytes, pcm.length) & ~1;
  const start = Math.max(0, target - searchBytes) & ~1;
  const sampleCount = (target - start) / BYTES_PER_SAMPLE;
  if (windowSamples < 1 || sampleCount <= windowSamples) {
    return target;
  }

  const abs = (sampleIndex: number) =>
    Math.abs(pcm.readInt16LE(start + sampleIndex * BYTES_PER_SAMPLE));

  let sum = 0;
  for (let i = 0; i < windowSamples; i += 1) {
    sum += abs(i);
  }
  let bestSum = sum;
  let bestStart = 0;
  for (let i = 1; i + windowSamples <= sampleCount; i += 1) {
    sum += abs(i + windowSamples - 1) - abs(i - 1);
    if (sum <= bestSum) {
      bestSum = sum;
      bestStart = i;
    }
  }

  const centerSample = bestStart + Math.floor(windowSamples / 2);
  const cut = start + centerSample * BYTES_PER_SAMPLE;
  return cut > 0 ? cut : target;
}

/**
 * Accumulates PCM16 bytes and hands back chunks of about 0.5 s (first) then 2 s. A chunk is
 * released when more bytes than the target are buffered, or, once playback has started, when the
 * estimated audio still queued in the app drops below 1 s (the provider can arrive in bursts
 * with stalls between them). A 10 ms holdback always stays buffered, so `flush()` has a
 * non-empty remainder for the last chunk.
 */
export class PcmChunker {
  private pending: Buffer = Buffer.alloc(0);
  private emitted = 0;
  private emittedSeconds = 0;
  private firstEmitAtMs: number | null = null;
  private readonly bytesPerSecond: number;
  private readonly windowSamples: number;
  private readonly holdbackBytes: number;
  private readonly minLowWaterBytes: number;

  constructor(sampleRate: number = DEFAULT_SAMPLE_RATE) {
    this.bytesPerSecond = sampleRate * BYTES_PER_SAMPLE;
    this.windowSamples = Math.max(1, Math.round(sampleRate * QUIET_WINDOW_SECONDS));
    this.minLowWaterBytes = Math.floor(this.bytesPerSecond * MIN_LOW_WATER_SECONDS) & ~1;
    this.holdbackBytes = Math.max(2, Math.floor(this.bytesPerSecond * HOLDBACK_SECONDS) & ~1);
  }

  push(data: Buffer, nowMs: number): Buffer[] {
    this.pending = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
    const out: Buffer[] = [];
    for (;;) {
      const target = this.targetBytes();
      if (this.pending.length > target) {
        const search = Math.min(
          Math.floor(this.bytesPerSecond * QUIET_SEARCH_SECONDS),
          target >> 1,
        );
        const cut = findQuietCutOffset(this.pending, target, search, this.windowSamples);
        out.push(this.take(cut, nowMs));
        continue;
      }
      const end = (this.pending.length - this.holdbackBytes) & ~1;
      if (
        this.emitted > 0 &&
        end >= this.minLowWaterBytes &&
        this.queuedAheadSeconds(nowMs) < LOW_WATER_SECONDS
      ) {
        const search = Math.min(
          Math.floor(this.bytesPerSecond * LOW_WATER_QUIET_SEARCH_SECONDS),
          end - this.minLowWaterBytes,
        );
        const cut = findQuietCutOffset(this.pending, end, search, this.windowSamples);
        out.push(this.take(cut > 0 ? cut : end, nowMs));
      }
      break;
    }
    return out;
  }

  flush(): Buffer | null {
    if (this.pending.length === 0) {
      return null;
    }
    const rest = this.pending;
    this.pending = Buffer.alloc(0);
    this.emitted += 1;
    return rest;
  }

  private take(bytes: number, nowMs: number): Buffer {
    const chunk = this.pending.subarray(0, bytes);
    this.pending = this.pending.subarray(bytes);
    if (this.firstEmitAtMs === null) {
      this.firstEmitAtMs = nowMs;
    }
    this.emitted += 1;
    this.emittedSeconds += bytes / this.bytesPerSecond;
    return chunk;
  }

  private queuedAheadSeconds(nowMs: number): number {
    const played = this.firstEmitAtMs === null ? 0 : (nowMs - this.firstEmitAtMs) / 1000;
    return this.emittedSeconds - played;
  }

  private targetBytes(): number {
    const seconds = this.emitted === 0 ? FIRST_CHUNK_SECONDS : CHUNK_SECONDS;
    return Math.floor(this.bytesPerSecond * seconds) & ~1;
  }
}
