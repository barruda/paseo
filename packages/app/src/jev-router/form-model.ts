// CUSTOM(jev-router): the router sheet's form, as a plain model (docs/forms.md). The sheet renders
// `getState()` and calls the commands; loading and saving the plugin settings go through the sheet.

import {
  DEFAULT_JEV_EFFORT_FOCUSED,
  DEFAULT_JEV_MODEL_FOCUSED,
  JEV_ROUTER_EFFORTS,
  JEV_UPGRADE_EFFORTS,
  JevRouterSettingsSchema,
  type JevRouterMode,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";

export type JevThresholdField =
  | "model.small"
  | "model.hard"
  | "effort.small"
  | "effort.hard"
  | "effort.deep";

/** The Operational model control's "Off" value. */
export const OPERATIONAL_OFF = "off";

export type JevPickSlot = "defaultPick" | "hardPick";

/** The host's TypeSafe provider, edited in Settings > Bruno's Customizations. */
export type JevProviderField = "apiKey" | "apiUrl" | "jevModel";

export type JevRouterFormLoad =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export interface JevRouterFormState {
  load: JevRouterFormLoad;
  revision: string | null;
  draft: JevRouterSettings;
  /** What each threshold field shows; the draft keeps the last valid number. */
  thresholdTexts: Record<JevThresholdField, string>;
  /** Bumped when the texts are replaced (load, reset): the uncontrolled inputs remount on it. */
  textsVersion: number;
  thresholdErrors: Partial<Record<JevThresholdField, string>>;
  apiUrlError: string | null;
  saving: boolean;
  error: string | null;
  canSave: boolean;
}

export interface JevRouterFormModel {
  getState(): JevRouterFormState;
  subscribe(listener: () => void): () => void;
  applyLoaded(values: JevRouterSettings, revision: string): void;
  applyLoadError(message: string): void;
  setEnabled(enabled: boolean): void;
  setMode(mode: JevRouterMode): void;
  setThresholdText(field: JevThresholdField, text: string): void;
  /** A model id, or `OPERATIONAL_OFF` to turn the Operational bucket off. */
  setOperationalModel(model: string): void;
  toggleOperationalEffort(effort: string): void;
  setPickModel(slot: JevPickSlot, model: string): void;
  setPickEffort(slot: JevPickSlot, effort: string): void;
  setLockCycling(lockCycling: boolean): void;
  setUseSonnet(useSonnet: boolean): void;
  setProviderField(field: JevProviderField, text: string): void;
  /** "Upgrade effort mid-session", in both modes; "Restore this mode's defaults" leaves it alone. */
  setUpgradeEnabled(enabled: boolean): void;
  toggleUpgradeEffort(effort: string): void;
  /** Puts the selected mode's models, efforts and thresholds back to their defaults. */
  resetMode(): void;
  beginSave(): void;
  saveFailed(message: string): void;
  saveSucceeded(revision: string): void;
  close(): void;
}

const THRESHOLD_FIELDS: readonly JevThresholdField[] = [
  "model.small",
  "model.hard",
  "effort.small",
  "effort.hard",
  "effort.deep",
];

function readThreshold(settings: JevRouterSettings, field: JevThresholdField): number {
  switch (field) {
    case "model.small":
      return settings.modelFocused.smallThreshold;
    case "model.hard":
      return settings.modelFocused.hardThreshold;
    case "effort.small":
      return settings.effortFocused.smallThreshold;
    case "effort.hard":
      return settings.effortFocused.hardThreshold;
    case "effort.deep":
      return settings.effortFocused.deepThreshold;
  }
}

function writeThreshold(
  settings: JevRouterSettings,
  field: JevThresholdField,
  value: number,
): JevRouterSettings {
  switch (field) {
    case "model.small":
      return { ...settings, modelFocused: { ...settings.modelFocused, smallThreshold: value } };
    case "model.hard":
      return { ...settings, modelFocused: { ...settings.modelFocused, hardThreshold: value } };
    case "effort.small":
      return { ...settings, effortFocused: { ...settings.effortFocused, smallThreshold: value } };
    case "effort.hard":
      return { ...settings, effortFocused: { ...settings.effortFocused, hardThreshold: value } };
    case "effort.deep":
      return { ...settings, effortFocused: { ...settings.effortFocused, deepThreshold: value } };
  }
}

/** Empty (jev.py's default endpoint) or an http(s) URL. */
export function isValidApiUrl(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || /^https?:\/\/\S+$/.test(trimmed);
}

/** A probability typed by hand: a number from 0 to 1, comma or dot. */
export function parseThreshold(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^(0|1|0?\.\d+|1\.0*)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 0 && value <= 1 ? value : null;
}

function textsFor(settings: JevRouterSettings): Record<JevThresholdField, string> {
  const texts = {} as Record<JevThresholdField, string>;
  for (const field of THRESHOLD_FIELDS) texts[field] = String(readThreshold(settings, field));
  return texts;
}

const EFFORT_ORDER: readonly string[] = JEV_ROUTER_EFFORTS;

export function openJevRouterForm(): JevRouterFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  const initial = JevRouterSettingsSchema.parse({});
  let state: JevRouterFormState = derive({
    load: { status: "loading" },
    revision: null,
    draft: initial,
    thresholdTexts: textsFor(initial),
    textsVersion: 0,
    thresholdErrors: {},
    apiUrlError: null,
    saving: false,
    error: null,
    canSave: false,
  });

  function derive(next: JevRouterFormState): JevRouterFormState {
    const thresholdErrors: Partial<Record<JevThresholdField, string>> = {};
    for (const field of THRESHOLD_FIELDS) {
      if (parseThreshold(next.thresholdTexts[field]) === null)
        thresholdErrors[field] = "A number from 0 to 1.";
    }
    const apiUrlError = isValidApiUrl(next.draft.apiUrl)
      ? null
      : "Empty, or a URL starting with https://.";
    return {
      ...next,
      thresholdErrors,
      apiUrlError,
      canSave:
        next.load.status === "ready" &&
        !next.saving &&
        Object.keys(thresholdErrors).length === 0 &&
        apiUrlError === null &&
        (!next.draft.effortFocused.operationalEnabled ||
          next.draft.effortFocused.operationalEfforts.length > 0) &&
        (!next.draft.upgradeEffort.enabled || next.draft.upgradeEffort.efforts.length > 0),
    };
  }

  function publish(patch: Partial<JevRouterFormState>): void {
    if (closed) return;
    state = derive({ ...state, ...patch });
    for (const listener of listeners) listener();
  }

  function edit(draft: JevRouterSettings): void {
    publish({ draft, error: null });
  }

  function editEffortFocused(patch: Partial<JevRouterSettings["effortFocused"]>): void {
    edit({ ...state.draft, effortFocused: { ...state.draft.effortFocused, ...patch } });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyLoaded(values, revision) {
      publish({
        load: { status: "ready" },
        revision,
        draft: values,
        thresholdTexts: textsFor(values),
        textsVersion: state.textsVersion + 1,
      });
    },
    applyLoadError(message) {
      publish({ load: { status: "error", message } });
    },
    setEnabled: (enabled) => edit({ ...state.draft, enabled }),
    setMode: (mode) => edit({ ...state.draft, mode }),
    setThresholdText(field, text) {
      const value = parseThreshold(text);
      const draft = value === null ? state.draft : writeThreshold(state.draft, field, value);
      publish({ draft, thresholdTexts: { ...state.thresholdTexts, [field]: text }, error: null });
    },
    setOperationalModel(model) {
      if (model === OPERATIONAL_OFF) editEffortFocused({ operationalEnabled: false });
      else editEffortFocused({ operationalEnabled: true, operationalModel: model });
    },
    toggleOperationalEffort(effort) {
      const current = state.draft.effortFocused.operationalEfforts;
      const next = current.includes(effort)
        ? current.filter((item) => item !== effort)
        : [...current, effort].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
      editEffortFocused({ operationalEfforts: next });
    },
    setPickModel(slot, model) {
      editEffortFocused({ [slot]: { ...state.draft.effortFocused[slot], model } });
    },
    setPickEffort(slot, effort) {
      editEffortFocused({ [slot]: { ...state.draft.effortFocused[slot], effort } });
    },
    setLockCycling: (lockCycling) => editEffortFocused({ lockCycling }),
    setUseSonnet: (useSonnet) =>
      edit({ ...state.draft, modelFocused: { ...state.draft.modelFocused, useSonnet } }),
    setProviderField: (field, text) => edit({ ...state.draft, [field]: text }),
    setUpgradeEnabled: (enabled) =>
      edit({ ...state.draft, upgradeEffort: { ...state.draft.upgradeEffort, enabled } }),
    toggleUpgradeEffort(effort) {
      const current = state.draft.upgradeEffort.efforts;
      const next = JEV_UPGRADE_EFFORTS.filter((item) =>
        item === effort ? !current.includes(item) : current.includes(item),
      );
      edit({ ...state.draft, upgradeEffort: { ...state.draft.upgradeEffort, efforts: next } });
    },
    resetMode() {
      const draft =
        state.draft.mode === "effort"
          ? { ...state.draft, effortFocused: { ...DEFAULT_JEV_EFFORT_FOCUSED } }
          : { ...state.draft, modelFocused: { ...DEFAULT_JEV_MODEL_FOCUSED } };
      publish({
        draft,
        thresholdTexts: textsFor(draft),
        textsVersion: state.textsVersion + 1,
        error: null,
      });
    },
    beginSave: () => publish({ saving: true, error: null }),
    saveFailed: (message) => publish({ saving: false, error: message }),
    saveSucceeded: (revision) => publish({ saving: false, revision }),
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
