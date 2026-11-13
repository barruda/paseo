import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { blockHasSignal, createMicLiveDetector, MIC_LIVE_FALLBACK_MS } from "./dictation-mic-live";

describe("blockHasSignal", () => {
  it("treats exact digital silence as no signal", () => {
    expect(blockHasSignal(new Float32Array(4096))).toBe(false);
  });

  it("ignores values at or under the threshold and finds a real sample", () => {
    const quiet = new Float32Array(100);
    quiet[10] = 5e-5;
    expect(blockHasSignal(quiet)).toBe(false);
    const loud = new Float32Array(100);
    loud[99] = -0.02;
    expect(blockHasSignal(loud)).toBe(true);
  });
});

describe("createMicLiveDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes live on the first block with signal, once", () => {
    const onLive = vi.fn();
    const detector = createMicLiveDetector(onLive);
    detector.start();
    detector.feed(new Float32Array(4096));
    detector.feed(new Float32Array(4096));
    expect(onLive).not.toHaveBeenCalled();
    detector.feed(Float32Array.of(0, 0.01));
    detector.feed(Float32Array.of(0.5));
    vi.advanceTimersByTime(MIC_LIVE_FALLBACK_MS * 2);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it("goes live after the fallback when the microphone stays silent", () => {
    const onLive = vi.fn();
    const detector = createMicLiveDetector(onLive);
    detector.start();
    vi.advanceTimersByTime(MIC_LIVE_FALLBACK_MS - 1);
    expect(onLive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it("reports nothing after dispose", () => {
    const onLive = vi.fn();
    const detector = createMicLiveDetector(onLive);
    detector.start();
    detector.dispose();
    detector.feed(Float32Array.of(0.5));
    vi.advanceTimersByTime(MIC_LIVE_FALLBACK_MS * 2);
    expect(onLive).not.toHaveBeenCalled();
  });

  it("can be marked live directly", () => {
    const onLive = vi.fn();
    const detector = createMicLiveDetector(onLive);
    detector.markLive();
    detector.markLive();
    expect(onLive).toHaveBeenCalledTimes(1);
  });
});
