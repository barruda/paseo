import { describe, expect, it } from "vitest";
import { createDoubleTrigger } from "./empty-voice-trigger";

describe("createDoubleTrigger", () => {
  function clock(start = 1000) {
    let time = start;
    return { now: () => time, advance: (ms: number) => (time += ms) };
  }

  it("fires on the second hit inside the window", () => {
    const c = clock();
    const trigger = createDoubleTrigger(400, c.now);
    expect(trigger.hit()).toBe(false);
    c.advance(200);
    expect(trigger.hit()).toBe(true);
  });

  it("does not fire when the hits are too far apart", () => {
    const c = clock();
    const trigger = createDoubleTrigger(400, c.now);
    expect(trigger.hit()).toBe(false);
    c.advance(500);
    expect(trigger.hit()).toBe(false);
    c.advance(100);
    expect(trigger.hit()).toBe(true);
  });

  it("starts over after firing and after reset", () => {
    const c = clock();
    const trigger = createDoubleTrigger(400, c.now);
    trigger.hit();
    expect(trigger.hit()).toBe(true);
    expect(trigger.hit()).toBe(false);
    trigger.reset();
    expect(trigger.hit()).toBe(false);
  });
});
