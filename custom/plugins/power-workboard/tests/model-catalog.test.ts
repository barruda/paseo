// CUSTOM(model-picker-workboard)
import { describe, expect, it } from "vitest";
import {
  activeInternalProviders,
  filterModelCatalog,
  groupModelCatalog,
  internalProviderOf,
  modelsForInternalProvider,
  type CatalogModel,
} from "../client/model-catalog";

const model = (
  id: string,
  label: string,
  metadata?: Record<string, unknown>,
): CatalogModel => ({ id, label, metadata });

const deepseek = model("deepseek/deepseek-flash", "DeepSeek Flash", {
  providerId: "deepseek",
  providerName: "DeepSeek",
});
const deepinfra = model(
  "deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "DeepSeek V4.1 Flash",
  { providerId: "deepinfra", providerName: "DeepInfra" },
);
const openai = model("openai/gpt-5", "GPT-5", {
  providerId: "openai",
  providerName: "OpenAI",
});
const withoutMetadata = model(
  "deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "DeepSeek V4.1 Flash",
);

describe("OpenCode internal providers", () => {
  it("reads the provider from metadata and falls back to the id prefix", () => {
    expect(internalProviderOf(deepseek, true)).toEqual({
      id: "deepseek",
      label: "DeepSeek",
    });
    expect(internalProviderOf(withoutMetadata, true)).toEqual({
      id: "deepinfra",
      label: "deepinfra",
    });
    expect(internalProviderOf(deepseek, false)).toBeNull();
  });

  it("lists only the providers that returned models, once each and sorted", () => {
    expect(
      activeInternalProviders([deepseek, deepinfra, openai, deepseek], true),
    ).toEqual([
      { id: "deepinfra", label: "DeepInfra" },
      { id: "deepseek", label: "DeepSeek" },
      { id: "openai", label: "OpenAI" },
    ]);
    expect(activeInternalProviders([deepseek], false)).toEqual([]);
  });

  it("scopes the models to one provider and keeps every model when none is chosen", () => {
    const models = [deepseek, deepinfra, openai];
    expect(modelsForInternalProvider(models, "deepinfra", true)).toEqual([
      deepinfra,
    ]);
    expect(modelsForInternalProvider(models, "", true)).toEqual(models);
    expect(modelsForInternalProvider(models, "deepseek", false)).toEqual(
      models,
    );
  });
});

describe("model picker search and groups", () => {
  const models = [deepseek, deepinfra, openai];

  it("finds a model by name, id or internal provider", () => {
    expect(filterModelCatalog(models, "flash", true)).toEqual([
      deepseek,
      deepinfra,
    ]);
    expect(filterModelCatalog(models, "deepinfra", true)).toEqual([deepinfra]);
    expect(filterModelCatalog(models, "gpt-5", true)).toEqual([openai]);
    expect(filterModelCatalog(models, "  ", true)).toEqual(models);
  });

  it("searches other providers by label and description", () => {
    const claude = {
      id: "claude-opus-5-5",
      label: "Opus",
      description: "Anthropic's largest",
    };
    expect(filterModelCatalog([claude], "opus", false)).toEqual([claude]);
    expect(filterModelCatalog([claude], "largest", false)).toEqual([claude]);
    expect(filterModelCatalog([claude], "deepseek", false)).toEqual([]);
  });

  it("groups by internal provider and drops empty groups", () => {
    const groups = groupModelCatalog([deepseek, deepinfra, openai], true);
    expect(groups.map((group) => group.provider?.id)).toEqual([
      "deepinfra",
      "deepseek",
      "openai",
    ]);
    expect(groups[0]?.models).toEqual([deepinfra]);
    expect(groupModelCatalog(models, false)).toEqual([
      { provider: null, models },
    ]);
  });
});
