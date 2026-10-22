import { describe, expect, it } from "vitest";
import {
  adjacentSentMessage,
  clearComposerRewindSelection,
  handleEmptyRewindKey,
  latestSentMessage,
  nextProjectId,
  previousProjectId,
  previousModelSelection,
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
  it("cycles projects forwards, undoing a backwards step", () => {
    const ids = ["a", "b", "c"];
    let selected: string | null = "a";
    const visits = [];
    for (let index = 0; index < 4; index++) {
      selected = nextProjectId(ids, selected);
      visits.push(selected);
    }
    expect(visits).toEqual(["b", "c", "a", "b"]);
    expect(nextProjectId(ids, previousProjectId(ids, "b"))).toBe("b");
    expect(nextProjectId(["a", "b"], null)).toBe("a");
    expect(nextProjectId(["a", "b"], "removed")).toBe("a");
    expect(nextProjectId([], null)).toBeNull();
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

it("Up and Down walk through sent messages, and Down past the latest clears", () => {
  clearComposerRewindSelection();
  const items = [message("first"), message("middle"), message(), message("last")];
  const press = (key: string) =>
    handleEmptyRewindKey({
      serverId: "host",
      agentId: "agent",
      items,
      event: {
        key,
        hasModifier: false,
        input: { text: "", selection: { start: 0, end: 0 } },
        preventDefault: () => {},
      },
    });
  const selected = () => useComposerRewindSelection.getState().selection?.messageId ?? null;
  expect(press("ArrowDown")).toBe(false);
  press("ArrowUp");
  expect(selected()).toBe("last");
  press("ArrowUp");
  expect(selected()).toBe("middle");
  press("ArrowUp");
  press("ArrowUp");
  expect(selected()).toBe("first");
  press("ArrowDown");
  expect(selected()).toBe("middle");
  press("ArrowDown");
  expect(selected()).toBe("last");
  expect(press("ArrowDown")).toBe(true);
  expect(selected()).toBeNull();
  expect(adjacentSentMessage(items, "removed", -1)).toBeNull();
});

it("cycles only available favorites in favorite order and handles empty favorites", () => {
  const row = (provider: string, modelId: string) => ({
    provider,
    modelId,
    favoriteKey: `${provider}:${modelId}`,
    providerLabel: provider,
    modelLabel: modelId,
  });
  const providers: import("@/provider-selection/provider-selection").ProviderSelectorProvider[] = [
    { id: "loading", label: "Loading", modelSelection: { kind: "loading" } },
    {
      id: "a",
      label: "A",
      modelSelection: { kind: "models", rows: [row("a", "one"), row("a", "two")] },
    },
    { id: "b", label: "B", modelSelection: { kind: "models", rows: [row("b", "three")] } },
  ];
  const favorites = ["b:three", "missing:model", "a:one"];
  expect(previousModelSelection(providers, "a", "one", favorites)?.modelId).toBe("three");
  expect(previousModelSelection(providers, "b", "three", favorites)?.modelId).toBe("one");
  expect(previousModelSelection(providers, "a", "two", favorites)?.modelId).toBe("one");
  expect(previousModelSelection(providers, null, null, favorites)?.modelId).toBe("one");
  expect(previousModelSelection(providers, "a", "one", ["a:one"])?.modelId).toBe("one");
  expect(previousModelSelection(providers, "a", "one", [])).toBeNull();
  expect(previousModelSelection(providers, null, null, ["missing:model"])).toBeNull();
  expect(previousModelSelection([], null, null, favorites)).toBeNull();
});
