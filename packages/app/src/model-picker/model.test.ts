import { describe, expect, it } from "vitest";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  buildModelPickerRows,
  moveEffortId,
  moveHighlightedKey,
  planModelPickerApply,
  resolveEffortId,
  resolveHighlightedKey,
  resolveModelEffort,
  toggleFavoriteKey,
  type ModelPickerSelection,
} from "./model";

const LOW_HIGH = [
  { id: "low", label: "Low" },
  { id: "high", label: "High", isDefault: true },
];
const LOW_MED_HIGH_MAX = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
];

function row(provider: string, providerLabel: string, modelId: string, modelLabel: string) {
  return { favoriteKey: `${provider}:${modelId}`, provider, providerLabel, modelId, modelLabel };
}

const PROVIDERS: ProviderSelectorProvider[] = [
  {
    id: "claude",
    label: "Claude",
    modelSelection: {
      kind: "models",
      rows: [
        { ...row("claude", "Claude", "opus", "Opus"), thinkingOptions: LOW_MED_HIGH_MAX },
        {
          ...row("claude", "Claude", "sonnet", "Sonnet"),
          thinkingOptions: LOW_HIGH,
          defaultThinkingOptionId: "low",
        },
      ],
    },
  },
  { id: "codex", label: "Codex", modelSelection: { kind: "loading" } },
  {
    id: "opencode",
    label: "OpenCode",
    modelSelection: {
      kind: "models",
      rows: [
        { ...row("opencode", "OpenCode", "gpt", "GPT"), thinkingOptions: LOW_HIGH },
        row("opencode", "OpenCode", "sonnet-oc", "Sonnet (OpenRouter)"),
      ],
    },
  },
];

function selection(overrides: Partial<ModelPickerSelection> = {}): ModelPickerSelection {
  return {
    providers: PROVIDERS,
    selectedProvider: "claude",
    selectedModelId: "opus",
    thinkingOptions: LOW_MED_HIGH_MAX,
    selectedThinkingId: "medium",
    ...overrides,
  };
}

describe("buildModelPickerRows", () => {
  it("lists the current model, then each provider's models", () => {
    const { rows, items } = buildModelPickerRows(selection(), "");
    expect(rows.map((r) => r.key)).toEqual([
      "section:current",
      "current:claude:opus",
      "section:claude",
      "claude:opus",
      "claude:sonnet",
      "section:opencode",
      "opencode:gpt",
      "opencode:sonnet-oc",
    ]);
    expect(items.every((item) => item.kind === "model")).toBe(true);
  });

  it("puts favorites, in the order they were added, between current and providers", () => {
    const { rows } = buildModelPickerRows(selection(), "", [
      "opencode:gpt",
      "gone:model",
      "claude:opus",
    ]);
    expect(rows.map((r) => r.key).slice(0, 5)).toEqual([
      "section:current",
      "current:claude:opus",
      "section:favorites",
      "favorite:opencode:gpt",
      "favorite:claude:opus",
    ]);
    expect(rows.find((r) => r.key === "claude:opus")).toMatchObject({
      model: { favorite: true, current: true },
    });
  });

  it("searches every provider's models in one flat list, favorites first", () => {
    const { rows } = buildModelPickerRows(selection(), "sonnet", ["opencode:sonnet-oc"]);
    expect(rows.every((r) => r.kind === "model")).toBe(true);
    expect(rows.map((r) => r.key)).toEqual(["opencode:sonnet-oc", "claude:sonnet"]);
  });
});

describe("toggleFavoriteKey", () => {
  it("appends a new favorite and removes an existing one", () => {
    expect(toggleFavoriteKey(["a:1"], "b:2")).toEqual(["a:1", "b:2"]);
    expect(toggleFavoriteKey(["a:1", "b:2"], "a:1")).toEqual(["b:2"]);
  });
});

describe("highlight", () => {
  const { items } = buildModelPickerRows(selection(), "", ["opencode:gpt"]);

  it("starts on the current model row and keeps a still-listed highlight", () => {
    expect(resolveHighlightedKey(null, items, true)).toBe("current:claude:opus");
    expect(resolveHighlightedKey("opencode:gpt", items, true)).toBe("opencode:gpt");
    expect(resolveHighlightedKey("gone:model", items, false)).toBe("current:claude:opus");
  });

  it("moves through every row, across sections, and wraps", () => {
    expect(moveHighlightedKey("current:claude:opus", items, 1)).toBe("favorite:opencode:gpt");
    expect(moveHighlightedKey("claude:sonnet", items, 1)).toBe("opencode:gpt");
    expect(moveHighlightedKey("opencode:sonnet-oc", items, 1)).toBe("current:claude:opus");
    expect(moveHighlightedKey("current:claude:opus", items, -1)).toBe("opencode:sonnet-oc");
  });
});

describe("effort", () => {
  const sel = selection();
  const { items } = buildModelPickerRows(sel, "");
  const byKey = (key: string) => items.find((item) => item.key === key)?.model ?? null;

  it("uses the live effort for the current model and the default for others", () => {
    expect(resolveModelEffort(sel, byKey("claude:opus")).baselineId).toBe("medium");
    expect(resolveModelEffort(sel, byKey("claude:sonnet")).baselineId).toBe("low");
    expect(resolveModelEffort(sel, byKey("opencode:gpt")).baselineId).toBe("high");
    expect(resolveModelEffort(sel, byKey("opencode:sonnet-oc"))).toEqual({
      options: [],
      baselineId: null,
    });
  });

  it("carries a chosen effort to models that offer it", () => {
    const sonnet = resolveModelEffort(sel, byKey("claude:sonnet"));
    expect(resolveEffortId(sonnet, "high")).toBe("high");
    expect(resolveEffortId(sonnet, "max")).toBe("low");
  });

  it("steps through effort levels without wrapping", () => {
    const opus = resolveModelEffort(sel, byKey("claude:opus"));
    expect(moveEffortId(opus, "medium", 1)).toBe("high");
    expect(moveEffortId(opus, "max", 1)).toBe("max");
    expect(moveEffortId(opus, "low", -1)).toBe("low");
  });
});

describe("planModelPickerApply", () => {
  const sel = selection();
  const { items } = buildModelPickerRows(sel, "");
  const byKey = (key: string) => items.find((item) => item.key === key)?.model ?? null;

  it("only changes the effort on the current model", () => {
    expect(
      planModelPickerApply({ selection: sel, model: byKey("claude:opus"), effortId: "max" }),
    ).toEqual({ kind: "effort", effortId: "max" });
    expect(
      planModelPickerApply({ selection: sel, model: byKey("claude:opus"), effortId: "medium" }),
    ).toEqual({ kind: "none" });
  });

  it("switches model and carries the effort for after the switch", () => {
    expect(
      planModelPickerApply({ selection: sel, model: byKey("opencode:gpt"), effortId: "low" }),
    ).toEqual({ kind: "model", provider: "opencode", modelId: "gpt", effortId: "low" });
  });
});
