// CUSTOM(model-picker-workboard): OpenCode models carry the internal provider in their metadata
// (`providerId`/`providerName`); the daemon already lists only connected or API-managed providers.
export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
  isSelectable?: boolean;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
  thinkingOptions?: readonly {
    id: string;
    label: string;
    isDefault?: boolean;
  }[];
}

export interface InternalProvider {
  id: string;
  label: string;
}

export interface ModelGroup {
  provider: InternalProvider | null;
  models: CatalogModel[];
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function internalProviderOf(
  model: Pick<CatalogModel, "id" | "metadata">,
  opencode: boolean,
): InternalProvider | null {
  if (!opencode) return null;
  const id = readText(model.metadata?.providerId);
  if (id) return { id, label: readText(model.metadata?.providerName) ?? id };
  const slash = model.id.indexOf("/");
  if (slash <= 0) return null;
  const prefix = model.id.slice(0, slash);
  return { id: prefix, label: prefix };
}

/** The internal providers that returned at least one model, sorted by name. */
export function activeInternalProviders(
  models: readonly CatalogModel[],
  opencode: boolean,
): InternalProvider[] {
  if (!opencode) return [];
  const found = new Map<string, InternalProvider>();
  for (const model of models) {
    const provider = internalProviderOf(model, true);
    if (provider && !found.has(provider.id)) found.set(provider.id, provider);
  }
  return [...found.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  );
}

/** One internal provider's models; every model when no provider is chosen. */
export function modelsForInternalProvider(
  models: readonly CatalogModel[],
  providerId: string,
  opencode: boolean,
): CatalogModel[] {
  if (!opencode || !providerId) return [...models];
  return models.filter(
    (model) => internalProviderOf(model, true)?.id === providerId,
  );
}

/** Search by model name, id, description and internal provider name. */
export function filterModelCatalog(
  models: readonly CatalogModel[],
  query: string,
  opencode: boolean,
): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...models];
  return models.filter((model) => {
    const provider = internalProviderOf(model, opencode);
    return [
      model.label,
      model.id,
      model.description,
      provider?.id,
      provider?.label,
    ].some((value) => value?.toLowerCase().includes(needle));
  });
}

export function groupModelCatalog(
  models: readonly CatalogModel[],
  opencode: boolean,
): ModelGroup[] {
  if (!opencode) return [{ provider: null, models: [...models] }];
  return activeInternalProviders(models, true)
    .map((provider) => ({
      provider,
      models: modelsForInternalProvider(models, provider.id, true),
    }))
    .filter((group) => group.models.length > 0);
}
