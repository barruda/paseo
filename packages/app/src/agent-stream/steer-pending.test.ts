import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { hideCancelledSteers, resolveSteerMessageState } from "./steer-pending";

const at = new Date("2026-11-13T12:00:00Z");
const user = (id: string, clientMessageId?: string): StreamItem => ({
  kind: "user_message",
  id,
  text: id,
  timestamp: at,
  ...(clientMessageId ? { clientMessageId } : {}),
});
const reply = (id: string): StreamItem => ({
  kind: "assistant_message",
  id,
  text: id,
  timestamp: at,
});

describe("resolveSteerMessageState", () => {
  it("is pending only for ids the daemon reports as pending", () => {
    const base = { pendingSteerMessageIds: ["a"], cancelledSteerMessageIds: [] };
    expect(resolveSteerMessageState({ ...base, clientMessageId: "a" })).toBe("pending");
    expect(resolveSteerMessageState({ ...base, clientMessageId: "b" })).toBe("delivered");
  });

  it("is cancelled for ids the daemon lists as cancelled, even if still pending", () => {
    expect(
      resolveSteerMessageState({
        clientMessageId: "a",
        pendingSteerMessageIds: ["a"],
        cancelledSteerMessageIds: ["a"],
      }),
    ).toBe("cancelled");
  });

  it("is delivered without a clientMessageId or on a daemon that reports nothing", () => {
    expect(
      resolveSteerMessageState({
        clientMessageId: undefined,
        pendingSteerMessageIds: ["a"],
        cancelledSteerMessageIds: ["a"],
      }),
    ).toBe("delivered");
    expect(
      resolveSteerMessageState({
        clientMessageId: "a",
        pendingSteerMessageIds: undefined,
        cancelledSteerMessageIds: undefined,
      }),
    ).toBe("delivered");
  });
});

describe("hideCancelledSteers", () => {
  it("removes only the cancelled user messages", () => {
    const items = [user("u1", "a"), reply("r1"), user("u2", "b"), user("u3")];
    expect(hideCancelledSteers(items, ["b"]).map((item) => item.id)).toEqual(["u1", "r1", "u3"]);
  });

  it("returns the same array when nothing is hidden", () => {
    const items = [user("u1", "a"), reply("r1")];
    expect(hideCancelledSteers(items, undefined)).toBe(items);
    expect(hideCancelledSteers(items, [])).toBe(items);
    expect(hideCancelledSteers(items, ["zzz"])).toBe(items);
  });
});
