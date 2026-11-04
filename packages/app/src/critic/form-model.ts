// CUSTOM(critic): the critic settings sheet's form, as a plain model (docs/forms.md). The sheet
// renders `getState()` and calls the commands; the loader and the save go through the adapter.

import {
  DEFAULT_CRITIC_CONFIG,
  type CriticConfig,
  type CriticImage,
  type CriticMode,
  type CriticTools,
} from "@getpaseo/protocol/critic";

/** Reference images travel in the config; keep the RPC payload small. */
export const CRITIC_IMAGES_MAX_BYTES = 8 * 1024 * 1024;

export type CriticFormLoad =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export interface CriticFormState {
  load: CriticFormLoad;
  /** The config as loaded; `enabled` here is what the agent last heard about. */
  saved: CriticConfig | null;
  draft: CriticConfig;
  saveAsDefault: boolean;
  saving: boolean;
  error: string | null;
  imageBytes: number;
  canSave: boolean;
}

export interface CriticFormModel {
  getState(): CriticFormState;
  subscribe(listener: () => void): () => void;
  applyLoaded(config: CriticConfig): void;
  applyLoadError(message: string): void;
  setEnabled(enabled: boolean): void;
  setModel(provider: string, model: string): void;
  setPrompt(prompt: string): void;
  addImages(images: readonly CriticImage[]): void;
  removeImage(index: number): void;
  reportImageError(message: string): void;
  setMode(mode: CriticMode): void;
  setTools(tools: CriticTools): void;
  setIncludeDiff(includeDiff: boolean): void;
  setMaxRounds(maxRounds: number): void;
  setSaveAsDefault(saveAsDefault: boolean): void;
  beginSave(): void;
  saveFailed(message: string): void;
  saveSucceeded(): void;
  close(): void;
}

/** Decoded size of a base64 payload. */
export function base64Bytes(data: string): number {
  let padding = 0;
  if (data.endsWith("==")) padding = 2;
  else if (data.endsWith("=")) padding = 1;
  return Math.floor((data.length * 3) / 4) - padding;
}

function imagesBytes(images: readonly CriticImage[]): number {
  return images.reduce((total, image) => total + base64Bytes(image.data), 0);
}

export function openCriticForm(): CriticFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state: CriticFormState = derive({
    load: { status: "loading" },
    saved: null,
    draft: DEFAULT_CRITIC_CONFIG,
    saveAsDefault: false,
    saving: false,
    error: null,
    imageBytes: 0,
    canSave: false,
  });

  function derive(next: CriticFormState): CriticFormState {
    const imageBytes = imagesBytes(next.draft.images);
    return {
      ...next,
      imageBytes,
      canSave: next.load.status === "ready" && !next.saving && next.draft.model.length > 0,
    };
  }

  function publish(patch: Partial<CriticFormState>): void {
    if (closed) return;
    state = derive({ ...state, ...patch });
    for (const listener of listeners) listener();
  }

  function editDraft(patch: Partial<CriticConfig>): void {
    publish({ draft: { ...state.draft, ...patch }, error: null });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyLoaded(config) {
      publish({ load: { status: "ready" }, saved: config, draft: config });
    },
    applyLoadError(message) {
      publish({ load: { status: "error", message } });
    },
    setEnabled: (enabled) => editDraft({ enabled }),
    setModel: (provider, model) => editDraft({ provider, model }),
    setPrompt: (prompt) => editDraft({ prompt }),
    addImages(images) {
      const next = [...state.draft.images, ...images];
      if (imagesBytes(next) > CRITIC_IMAGES_MAX_BYTES) {
        publish({ error: "Reference images are limited to 8 MB in total." });
        return;
      }
      editDraft({ images: next });
    },
    removeImage(index) {
      editDraft({ images: state.draft.images.filter((_, position) => position !== index) });
    },
    reportImageError: (message) => publish({ error: message }),
    setMode: (mode) => editDraft({ mode }),
    setTools: (tools) => editDraft({ tools }),
    setIncludeDiff: (includeDiff) => editDraft({ includeDiff }),
    setMaxRounds: (maxRounds) => editDraft({ maxRounds }),
    setSaveAsDefault: (saveAsDefault) => publish({ saveAsDefault }),
    beginSave: () => publish({ saving: true, error: null }),
    saveFailed: (message) => publish({ saving: false, error: message }),
    saveSucceeded: () => publish({ saving: false, saved: state.draft }),
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
