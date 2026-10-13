import { describe, expect, it } from "vitest";

import { scalePcm16, thinkingToneGain } from "./thinking-tone-settings";

describe("thinking tone volume", () => {
  it("scales PCM16 samples and leaves full volume untouched", () => {
    const pcm = new Uint8Array(new Int16Array([1000, -1000, 32767]).buffer);

    expect(scalePcm16(pcm, thinkingToneGain("high"))).toBe(pcm);

    const scaled = scalePcm16(pcm, thinkingToneGain("low"));
    expect(Array.from(new Int16Array(scaled.buffer))).toEqual([300, -300, 9830]);
  });
});
