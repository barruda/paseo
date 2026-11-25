import { describe, expect, it } from "vitest";
import {
  parsePiModels,
  readProviders,
  removeModel,
  removeProvider,
  serializePiModels,
  upsertModel,
  upsertProvider,
  writeLevelMap,
  type PiModelPatch,
} from "./document";

const SOURCE = JSON.stringify({
  $schema: "https://pi.dev/schemas/models.schema.json",
  providers: {
    fuelix: {
      baseUrl: "https://api.example/v1",
      api: "openai-completions",
      apiKey: "secret",
      headers: { "X-Team": "a" },
      models: [
        { id: "flash", name: "Flash", contextWindow: 128000, reasoning: true },
        {
          id: "sol",
          api: "openai-responses",
          reasoning: true,
          thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  },
});

function patch(overrides: Partial<PiModelPatch> = {}): PiModelPatch {
  return {
    id: "sol",
    name: "",
    api: "openai-responses",
    reasoning: true,
    contextWindow: "",
    maxTokens: "",
    images: false,
    levels: ["low", "medium", "high", "xhigh", "max"],
    ...overrides,
  };
}

describe("pi models document", () => {
  it("reads providers, models and their thinking levels", () => {
    const [provider] = readProviders(parsePiModels(SOURCE));
    expect(provider).toMatchObject({ id: "fuelix", api: "openai-completions", apiKey: "secret" });
    expect(provider?.models[0]?.levels).toEqual(["off", "minimal", "low", "medium", "high"]);
    expect(provider?.models[1]?.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("treats an empty file as no providers", () => {
    expect(readProviders(parsePiModels(""))).toEqual([]);
  });

  it("keeps fields the editor does not know when it saves a model", () => {
    const doc = upsertModel(parsePiModels(SOURCE), "fuelix", 1, patch({ name: "Sol" }));
    const saved = JSON.parse(serializePiModels(doc));
    expect(saved.$schema).toBe("https://pi.dev/schemas/models.schema.json");
    expect(saved.providers.fuelix.headers).toEqual({ "X-Team": "a" });
    expect(saved.providers.fuelix.models[1]).toMatchObject({
      id: "sol",
      name: "Sol",
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
    });
  });

  it("maps xhigh and max explicitly and drops the map when thinking is off", () => {
    expect(writeLevelMap(undefined, ["low", "high", "max"])).toEqual({
      off: null,
      minimal: null,
      medium: null,
      max: "max",
    });
    expect(writeLevelMap(undefined, ["off", "minimal", "low", "medium", "high"])).toBeUndefined();
    const doc = upsertModel(parsePiModels(SOURCE), "fuelix", 1, patch({ reasoning: false }));
    const sol = JSON.parse(serializePiModels(doc)).providers.fuelix.models[1];
    expect(sol.reasoning).toBeUndefined();
    expect(sol.thinkingLevelMap).toBeUndefined();
  });

  it("keeps a hand-written provider value for a level", () => {
    expect(writeLevelMap({ high: "max-effort", xhigh: "x" }, ["high", "xhigh"])).toMatchObject({
      high: "max-effort",
      xhigh: "x",
    });
  });

  it("adds, renames and removes providers and models", () => {
    let doc = upsertProvider(parsePiModels(SOURCE), null, {
      id: "local",
      name: "",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
    });
    doc = upsertModel(doc, "local", null, patch({ id: "qwen", api: "", reasoning: false }));
    doc = upsertProvider(doc, "local", {
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
    });
    expect(readProviders(doc).map((provider) => provider.id)).toEqual(["fuelix", "ollama"]);
    expect(readProviders(doc)[1]?.models.map((model) => model.id)).toEqual(["qwen"]);
    doc = removeModel(doc, "fuelix", 0);
    expect(readProviders(doc)[0]?.models.map((model) => model.id)).toEqual(["sol"]);
    doc = removeProvider(doc, "ollama");
    expect(readProviders(doc).map((provider) => provider.id)).toEqual(["fuelix"]);
  });

  it("rejects duplicate ids and bad token counts", () => {
    const doc = parsePiModels(SOURCE);
    expect(() => upsertModel(doc, "fuelix", 0, patch())).toThrow(/already exists/);
    expect(() => upsertModel(doc, "fuelix", 1, patch({ contextWindow: "lots" }))).toThrow(
      /whole number/,
    );
  });
});
