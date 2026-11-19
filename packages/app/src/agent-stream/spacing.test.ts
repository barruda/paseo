import { describe, expect, it } from "vitest";
import { getAssistantMessageSpacing, getGapBetweenStreamItems } from "./spacing";
import type { StreamItem } from "@/types/stream";
const message: StreamItem = {
  kind: "assistant_message",
  id: "m",
  text: "First\n\nSecond",
  timestamp: new Date(0),
};
describe("whole-message spacing", () => {
  it("compacts only the gap to its turn footer", () => {
    expect(getAssistantMessageSpacing({ item: message })).toBe("default");
    expect(getAssistantMessageSpacing({ item: message, hasFooterBelow: true })).toBe(
      "compactBottom",
    );
  });
  // CUSTOM(timeline-transformer-agent)
  it("compacts a plugin row that replaced a reply like the reply itself", () => {
    const other: StreamItem = {
      kind: "plugin",
      id: "p/usage",
      sourceId: "m",
      timestamp: new Date(0),
      pluginId: "p",
      pluginItemId: "usage",
      itemKind: "card",
      version: 1,
      data: null,
    };
    const replaced: StreamItem = { ...other, id: "p/m", sourceAssistantText: message.text };

    expect(getAssistantMessageSpacing({ item: replaced, hasFooterBelow: true })).toBe(
      getAssistantMessageSpacing({ item: message, hasFooterBelow: true }),
    );
    expect(getAssistantMessageSpacing({ item: replaced })).toBe("default");
    expect(getAssistantMessageSpacing({ item: other, hasFooterBelow: true })).toBe("default");
  });
  it("keeps separate messages separated", () => {
    expect(getGapBetweenStreamItems(message, { ...message, id: "next" })).toBeGreaterThan(0);
  });
});
