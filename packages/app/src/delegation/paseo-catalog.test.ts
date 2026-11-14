import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import {
  offeredThinkingIds,
  paseoModelOptions,
  paseoProviderOptions,
  paseoThinkingOptions,
} from "./paseo-catalog";

const entries: ProviderSnapshotEntry[] = [
  {
    provider: "claude",
    status: "ready",
    enabled: true,
    label: "Claude Code",
    models: [
      {
        provider: "claude",
        id: "opus",
        label: "Opus",
        isDefault: true,
        thinkingOptions: [{ id: "high", label: "High" }],
      },
      { provider: "claude", id: "haiku", label: "Haiku" },
      { provider: "claude", id: "hidden", label: "Hidden", isSelectable: false },
    ],
  },
  { provider: "codex", status: "ready", enabled: true, models: [] },
  { provider: "off", status: "ready", enabled: false },
];

describe("paseo catalog options", () => {
  it("lists enabled providers and keeps a stored one the host no longer has", () => {
    expect(paseoProviderOptions(entries, "claude")).toEqual([
      { value: "claude", label: "Claude Code" },
      { value: "codex", label: "codex" },
    ]);
    expect(paseoProviderOptions(entries, "gone").at(-1)).toEqual({ value: "gone", label: "gone" });
  });

  it("offers Default first, then the selectable models", () => {
    expect(paseoModelOptions(entries, "claude", "")).toEqual([
      { value: "", label: "Default" },
      { value: "opus", label: "Opus" },
      { value: "haiku", label: "Haiku" },
    ]);
    expect(paseoModelOptions(entries, "claude", "old").at(-1)).toEqual({
      value: "old",
      label: "old",
    });
  });

  it("takes thinking options from the chosen model, or the default model when none is chosen", () => {
    expect(paseoThinkingOptions(entries, "claude", "opus", "")).toEqual([
      { value: "", label: "Default" },
      { value: "high", label: "High" },
    ]);
    expect(offeredThinkingIds(entries, "claude", "")).toEqual(["high"]);
    expect(offeredThinkingIds(entries, "claude", "haiku")).toEqual([]);
    expect(offeredThinkingIds(entries, "nope", "")).toEqual([]);
  });
});
