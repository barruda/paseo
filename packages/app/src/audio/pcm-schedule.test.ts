import { describe, expect, it } from "vitest";

import { computeEarlyResolveDelayMs, computeStartAt } from "./pcm-schedule";

describe("computeStartAt", () => {
  it("starts right after the previous chunk while it is still playing", () => {
    expect(computeStartAt(10, 10.4)).toBe(10.4);
  });

  it("starts now when the previous chunk already ended", () => {
    expect(computeStartAt(10, 9.7)).toBe(10);
  });
});

describe("computeEarlyResolveDelayMs", () => {
  it("resolves 0.15 s before the scheduled end", () => {
    expect(computeEarlyResolveDelayMs(10, 10, 2)).toBe(1850);
    expect(computeEarlyResolveDelayMs(10, 10.4, 2)).toBe(2250);
  });

  it("resolves immediately when less than the lead remains", () => {
    expect(computeEarlyResolveDelayMs(10, 10, 0.1)).toBe(0);
    expect(computeEarlyResolveDelayMs(12, 10, 2)).toBe(0);
  });
});
