import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { findTurnUsageItem, isTurnUsageItem } from "./turn-usage";

function at(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function assistant(id: string, seed: number): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: at(seed) };
}

function user(id: string, seed: number): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: at(seed) };
}

function usage(id: string, seed: number, pluginId = "token-ledger"): StreamItem {
  return {
    kind: "plugin",
    id,
    timestamp: at(seed),
    pluginId,
    pluginItemId: id,
    itemKind: "turn-usage",
    version: 1,
    data: {},
  };
}

describe("findTurnUsageItem", () => {
  const strategy = resolveStreamRenderStrategy({ platform: "web", isMobileBreakpoint: false });

  it("finds the usage row recorded after the response", () => {
    const items = [user("u1", 1), assistant("a1", 2), usage("t1", 3)];

    const ordered = strategy.orderTail(items);
    const assistantIndex = ordered.findIndex((item) => item.id === "a1");
    expect(findTurnUsageItem({ strategy, items: ordered, startIndex: assistantIndex })?.id).toBe(
      "t1",
    );
  });

  it("does not take the next turn's usage row", () => {
    const ordered = strategy.orderTail([assistant("a1", 1), user("u2", 2), usage("t2", 3)]);
    const assistantIndex = ordered.findIndex((item) => item.id === "a1");

    expect(findTurnUsageItem({ strategy, items: ordered, startIndex: assistantIndex })).toBeNull();
  });

  it("ignores usage rows from other plugins", () => {
    expect(isTurnUsageItem(usage("t1", 1, "someone-else"))).toBe(false);
  });
});
