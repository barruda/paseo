import { PI_THINKING_LEVELS, type PiThinkingLevel } from "@getpaseo/protocol/pi-models";

// CUSTOM(pi-models): the editor's view of Pi's models.json. Edits go through these functions so every
// field the editor does not know (headers, compat, cost, modelOverrides, $schema...) survives a save.

type Json = Record<string, unknown>;

export interface PiModelsDocument {
  root: Json;
}

export interface PiProviderView {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  models: PiModelView[];
}

export interface PiModelView {
  index: number;
  id: string;
  name: string;
  /** Per-model override of the provider's api; "" uses the provider's. */
  api: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
  images: boolean;
  /** Levels Pi offers for this model, in order (only meaningful with `reasoning`). */
  levels: PiThinkingLevel[];
}

export interface PiProviderPatch {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  apiKey: string;
}

export interface PiModelPatch {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
  images: boolean;
  levels: PiThinkingLevel[];
}

/** Levels Pi sends with the provider's default value when the model does not map them. */
const DEFAULT_SUPPORTED: ReadonlySet<PiThinkingLevel> = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]);

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function parsePiModels(source: string): PiModelsDocument {
  if (!source.trim()) return { root: { providers: {} } };
  const parsed: unknown = JSON.parse(source);
  if (!isObject(parsed)) throw new Error("models.json must be a JSON object.");
  return { root: parsed };
}

export function serializePiModels(doc: PiModelsDocument): string {
  return `${JSON.stringify(doc.root, null, 2)}\n`;
}

function providersOf(root: Json): Json {
  return isObject(root.providers) ? root.providers : {};
}

function modelsOf(provider: Json): unknown[] {
  return Array.isArray(provider.models) ? provider.models : [];
}

export function readLevels(model: Json): PiThinkingLevel[] {
  const map = isObject(model.thinkingLevelMap) ? model.thinkingLevelMap : {};
  return PI_THINKING_LEVELS.filter((level) => {
    if (!(level in map)) return DEFAULT_SUPPORTED.has(level);
    return map[level] !== null;
  });
}

/**
 * The thinkingLevelMap that offers exactly `levels`. A mapped value the user wrote by hand is kept;
 * a supported level Pi handles by default is left out of the map.
 */
export function writeLevelMap(
  previous: unknown,
  levels: readonly PiThinkingLevel[],
): Json | undefined {
  const before = isObject(previous) ? previous : {};
  const map: Json = {};
  for (const [key, value] of Object.entries(before)) {
    if (!(PI_THINKING_LEVELS as readonly string[]).includes(key)) map[key] = value;
  }
  for (const level of PI_THINKING_LEVELS) {
    const wanted = levels.includes(level);
    const value = before[level];
    if (!wanted) {
      if (DEFAULT_SUPPORTED.has(level)) map[level] = null;
    } else if (typeof value === "string") map[level] = value;
    else if (!DEFAULT_SUPPORTED.has(level)) map[level] = level;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function readModel(raw: unknown, index: number): PiModelView | null {
  if (!isObject(raw)) return null;
  const input = Array.isArray(raw.input) ? raw.input : [];
  return {
    index,
    id: text(raw.id),
    name: text(raw.name),
    api: text(raw.api),
    reasoning: raw.reasoning === true,
    contextWindow: numberText(raw.contextWindow),
    maxTokens: numberText(raw.maxTokens),
    images: input.includes("image"),
    levels: readLevels(raw),
  };
}

export function readProviders(doc: PiModelsDocument): PiProviderView[] {
  return Object.entries(providersOf(doc.root)).map(([id, raw]) => {
    const provider = isObject(raw) ? raw : {};
    return {
      id,
      name: text(provider.name),
      baseUrl: text(provider.baseUrl),
      api: text(provider.api),
      apiKey: text(provider.apiKey),
      models: modelsOf(provider)
        .map(readModel)
        .filter((model): model is PiModelView => model !== null),
    };
  });
}

function assign(target: Json, key: string, value: unknown): void {
  if (value === undefined || value === "") delete target[key];
  else target[key] = value;
}

function parseCount(value: string, field: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(/[_\s]/g, ""));
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${field} must be a whole number of tokens.`);
  return parsed;
}

/** Writes a provider's connection fields; `previousId` null adds a provider. Keeps key order. */
export function upsertProvider(
  doc: PiModelsDocument,
  previousId: string | null,
  patch: PiProviderPatch,
): PiModelsDocument {
  const id = patch.id.trim();
  if (!id) throw new Error("The provider needs an id.");
  const providers = providersOf(doc.root);
  if (id !== previousId && id in providers) throw new Error(`Provider "${id}" already exists.`);
  const next: Json = {};
  let placed = false;
  for (const [key, value] of Object.entries(providers)) {
    if (key === previousId) {
      next[id] = applyProvider(isObject(value) ? value : {}, patch);
      placed = true;
    } else next[key] = value;
  }
  if (!placed) next[id] = applyProvider({ models: [] }, patch);
  return { root: { ...doc.root, providers: next } };
}

function applyProvider(previous: Json, patch: PiProviderPatch): Json {
  const provider = { ...previous };
  assign(provider, "name", patch.name.trim());
  assign(provider, "baseUrl", patch.baseUrl.trim());
  assign(provider, "api", patch.api.trim());
  assign(provider, "apiKey", patch.apiKey.trim());
  return provider;
}

export function removeProvider(doc: PiModelsDocument, id: string): PiModelsDocument {
  const providers = { ...providersOf(doc.root) };
  delete providers[id];
  return { root: { ...doc.root, providers } };
}

/** Writes a model; `index` null appends it. */
export function upsertModel(
  doc: PiModelsDocument,
  providerId: string,
  index: number | null,
  patch: PiModelPatch,
): PiModelsDocument {
  const id = patch.id.trim();
  if (!id) throw new Error("The model needs an id.");
  const providers = providersOf(doc.root);
  const provider = providers[providerId];
  if (!isObject(provider)) throw new Error(`Provider "${providerId}" is gone.`);
  const models = [...modelsOf(provider)];
  const clash = models.findIndex((model, i) => i !== index && isObject(model) && model.id === id);
  if (clash >= 0) throw new Error(`Model "${id}" already exists in ${providerId}.`);
  const previous = index !== null && isObject(models[index]) ? (models[index] as Json) : {};
  const model = { ...previous };
  model.id = id;
  assign(model, "name", patch.name.trim());
  assign(model, "api", patch.api.trim());
  assign(model, "reasoning", patch.reasoning ? true : undefined);
  assign(model, "contextWindow", parseCount(patch.contextWindow, "Context window"));
  assign(model, "maxTokens", parseCount(patch.maxTokens, "Max output tokens"));
  const input = Array.isArray(previous.input)
    ? previous.input.filter((kind) => kind !== "image")
    : ["text"];
  const withoutImages = input.length > 1 ? input : undefined;
  assign(model, "input", patch.images ? [...input, "image"] : withoutImages);
  assign(
    model,
    "thinkingLevelMap",
    patch.reasoning ? writeLevelMap(previous.thinkingLevelMap, patch.levels) : undefined,
  );
  if (index === null) models.push(model);
  else models[index] = model;
  return {
    root: { ...doc.root, providers: { ...providers, [providerId]: { ...provider, models } } },
  };
}

export function removeModel(
  doc: PiModelsDocument,
  providerId: string,
  index: number,
): PiModelsDocument {
  const providers = providersOf(doc.root);
  const provider = providers[providerId];
  if (!isObject(provider)) return doc;
  const models = modelsOf(provider).filter((_, i) => i !== index);
  return {
    root: { ...doc.root, providers: { ...providers, [providerId]: { ...provider, models } } },
  };
}
