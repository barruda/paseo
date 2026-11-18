import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getCachedFile, setCachedFile } from "../shared/file-cache";
import { readImageRpc } from "../shared/rpc";
import { backgroundSchema, defaults, preferenceRpc, type BackgroundSettings } from "../shared/settings";
import { after, createWebRuntime, isVisible, onWake, profileId, type RuntimeState } from "./web";

export interface ControllerState {
  loading: boolean;
  saving: boolean;
  values: BackgroundSettings;
  revision: string;
  error: string | null;
  runtime: RuntimeState;
}

export function createController(client: PluginClientContext) {
  let state: ControllerState = { loading: true, saving: false, values: defaults(), revision: "", error: null,
    runtime: { status: "off", surfaces: 0, error: null } };
  const listeners = new Set<() => void>();
  let stopped = false;
  let reading = false;
  let operation = 0;
  let preview: { token: symbol; values: BackgroundSettings } | null = null;
  let cancelTimer: (() => void) | null = null;
  const emit = (patch: Partial<ControllerState>) => {
    if (stopped) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const runtime = createWebRuntime((next) => {
    if (JSON.stringify(next) !== JSON.stringify(state.runtime)) emit({ runtime: next });
  });
  // CUSTOM(background-local-image): fetch local images from the host once, then repaint.
  const loadingFiles = new Set<string>();
  const failedFiles = new Set<string>();
  function ensureFiles(...all: BackgroundSettings[]) {
    for (const { source } of all) {
      if (source.kind !== "file" || getCachedFile(source.id) || loadingFiles.has(source.id) || failedFiles.has(source.id)) continue;
      const id = source.id;
      loadingFiles.add(id);
      void client.rpc(readImageRpc, { id }).then((image) => {
        setCachedFile(id, `data:${image.mimeType};base64,${image.base64}`);
      }, (error: unknown) => {
        failedFiles.add(id);
        emit({ error: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        loadingFiles.delete(id);
        if (stopped) return;
        paint();
        emit({});
      });
    }
  }
  const paint = (claim = false) => {
    ensureFiles(state.values, ...(preview ? [preview.values] : []));
    runtime.update(preview?.values ?? state.values, Boolean(preview), claim);
  };

  async function refresh() {
    if (stopped || reading || state.saving) return;
    reading = true;
    const started = operation;
    try {
      const result = await client.rpc(preferenceRpc.read, {});
      if (stopped || started !== operation) return;
      if (result.status !== "ready") {
        emit({ loading: false, values: defaults(), revision: result.revision, error: result.error });
        paint();
        return;
      }
      const parsed = backgroundSchema.safeParse(result.values);
      if (!parsed.success) {
        emit({ loading: false, values: defaults(), revision: result.revision, error: parsed.error.message });
        paint();
        return;
      }
      const values = parsed.data;
      const changed = result.revision !== state.revision || state.loading;
      emit({ loading: false, values, revision: result.revision, error: null });
      if (changed) paint();
    } catch (error) {
      if (started === operation) emit({ loading: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      reading = false;
    }
  }
  function poll() {
    cancelTimer = after(() => { if (isVisible()) void refresh(); poll(); }, 5000);
  }
  const releaseWake = onWake(() => { if (isVisible()) void refresh(); });
  void refresh();
  poll();

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    refresh,
    preview(token: symbol, values: BackgroundSettings) { preview = { token, values }; paint(); },
    cancelPreview(token: symbol) { if (preview?.token === token) { preview = null; paint(); } },
    claim() { paint(true); },
    async save(values: BackgroundSettings, revision: string) {
      if (state.saving || stopped) return false;
      ++operation;
      emit({ saving: true, error: null });
      try {
        const parsed = backgroundSchema.parse({ ...values, profileId: values.profileId || profileId() });
        const result = await client.rpc(preferenceRpc.write, { values: parsed, revision });
        if (stopped) return false;
        if (result.status !== "saved") throw new Error(result.error);
        preview = null;
        emit({ values: backgroundSchema.parse(result.values), revision: result.revision });
        paint(true);
        return true;
      } catch (error) {
        emit({ error: error instanceof Error ? error.message : String(error) });
        return false;
      } finally { emit({ saving: false }); }
    },
    async toggle() { return this.save({ ...state.values, enabled: !state.values.enabled }, state.revision); },
    dispose() { stopped = true; cancelTimer?.(); releaseWake(); runtime.dispose(); listeners.clear(); },
  };
}

export type BackgroundController = ReturnType<typeof createController>;
