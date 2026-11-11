import { describe, expect, it } from "vitest";
import { DelegationTracker } from "./tracker";

const card = {
  implementerModel: "sonnet",
  implementerEffort: "medium",
  when: "balanced",
  review: true,
  searchModel: "off",
} as const;

describe("DelegationTracker", () => {
  it("ties a creation's id to the agent once, then forgets it", () => {
    const tracker = new DelegationTracker();
    const id = tracker.begin(card, "claude-opus-5-5");
    tracker.bind(id, "agent-1");
    expect(tracker.take("agent-1")?.mainModel).toBe("claude-opus-5-5");
    expect(tracker.take("agent-1")).toBeNull();
  });

  it("ignores agents it never saw and ids it never issued", () => {
    const tracker = new DelegationTracker();
    tracker.bind("unknown", "agent-2");
    expect(tracker.take("agent-2")).toBeNull();
  });

  it("drops entries older than ten minutes", () => {
    let now = 0;
    const tracker = new DelegationTracker(() => now);
    const id = tracker.begin(card, null);
    tracker.bind(id, "agent-3");
    now = 11 * 60_000;
    expect(tracker.take("agent-3")).toBeNull();
  });
});
