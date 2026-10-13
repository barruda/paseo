import { describe, expect, it } from "vitest";
import {
  clearComposerRewindSelection,
  handleEmptyRewindKey,
  latestSentMessage,
  previousProjectId,
  useComposerRewindSelection,
} from "./empty-shortcuts";
import type { StreamItem } from "@/types/stream";

function message(messageId?: string): StreamItem {
  return {
    kind: "user_message",
    id: messageId ?? "pending",
    messageId,
    text: "Hello",
    timestamp: new Date(0),
  };
}

describe("empty composer shortcuts", () => {
  it("cycles projects backwards and wraps repeatedly", () => {
    const ids = ["a", "b", "c"];
    let selected: string | null = "a";
    const visits = [];
    for (let index = 0; index < 6; index++) {
      selected = previousProjectId(ids, selected);
      visits.push(selected);
    }
    expect(visits).toEqual(["c", "b", "a", "c", "b", "a"]);
  });
  it("handles missing selection, a single project, and no projects", () => {
    expect(previousProjectId(["a", "b"], null)).toBe("b");
    expect(previousProjectId(["a", "b"], "removed")).toBe("b");
    expect(previousProjectId(["a"], "a")).toBe("a");
    expect(previousProjectId([], null)).toBeNull();
  });
  it("selects the latest sent message rather than an unsent prompt", () => {
    expect(latestSentMessage([message("first"), message("last"), message()])).toBe("last");
    expect(latestSentMessage([message()])).toBeNull();
    expect(latestSentMessage([])).toBeNull();
  });
});

it("Up selects, Enter opens options, and typing or Escape clears selection", () => {
  clearComposerRewindSelection();
  let prevented = 0;
  function press(key: string, text = "", hasModifier = false) {
    return handleEmptyRewindKey({
      serverId: "host",
      agentId: "agent",
      items: [message("last")],
      event: {
        key,
        hasModifier,
        input: { text, selection: { start: text.length, end: text.length } },
        preventDefault: () => {
          prevented++;
        },
      },
    });
  }
  expect(press("ArrowUp", "draft")).toBe(false);
  expect(press("ArrowUp", "", true)).toBe(false);
  expect(press("Enter")).toBe(false);
  expect(useComposerRewindSelection.getState().selection).toBeNull();
  expect(press("ArrowUp")).toBe(true);
  expect(useComposerRewindSelection.getState().selection).toEqual({
    serverId: "host",
    agentId: "agent",
    messageId: "last",
    open: false,
  });
  expect(press("Enter")).toBe(true);
  expect(useComposerRewindSelection.getState().selection?.open).toBe(true);
  expect(press("Escape")).toBe(false);
  expect(useComposerRewindSelection.getState().selection).toBeNull();
  expect(press("ArrowUp")).toBe(true);
  expect(press("h")).toBe(false);
  expect(useComposerRewindSelection.getState().selection).toBeNull();
  expect(prevented).toBe(3);
});
