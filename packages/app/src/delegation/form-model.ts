// CUSTOM(delegation): the delegation sheet's form, as a plain model (docs/forms.md). The sheet
// renders `getState()` and calls the commands; loading and saving the plugin settings go through
// the sheet.

import {
  DEFAULT_DELEGATION,
  DelegationSettingsSchema,
  MAX_DELEGATION_EXTRA_CHARS,
  type DelegationSettings,
} from "@getpaseo/protocol/delegation";

export type DelegationFormLoad =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export interface DelegationFormState {
  load: DelegationFormLoad;
  revision: string | null;
  draft: DelegationSettings;
  /** Bumped when the draft is replaced (load, reset): the uncontrolled text input remounts on it. */
  textsVersion: number;
  extraError: string | null;
  saving: boolean;
  error: string | null;
  canSave: boolean;
}

export interface DelegationFormModel {
  getState(): DelegationFormState;
  subscribe(listener: () => void): () => void;
  applyLoaded(values: DelegationSettings, revision: string): void;
  applyLoadError(message: string): void;
  /** Sets one field of the draft; the sheet's controls each own one. */
  set<Key extends keyof DelegationSettings>(key: Key, value: DelegationSettings[Key]): void;
  /** Everything back to the defaults except on/off (the Subagents tab included). */
  resetDefaults(): void;
  beginSave(): void;
  saveFailed(message: string): void;
  saveSucceeded(revision: string): void;
  close(): void;
}

export function openDelegationForm(): DelegationFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state: DelegationFormState = derive({
    load: { status: "loading" },
    revision: null,
    draft: DelegationSettingsSchema.parse({}),
    textsVersion: 0,
    extraError: null,
    saving: false,
    error: null,
    canSave: false,
  });

  function derive(next: DelegationFormState): DelegationFormState {
    const extraError =
      next.draft.extraInstructions.length > MAX_DELEGATION_EXTRA_CHARS
        ? `At most ${MAX_DELEGATION_EXTRA_CHARS} characters.`
        : null;
    return {
      ...next,
      extraError,
      canSave: next.load.status === "ready" && !next.saving && extraError === null,
    };
  }

  function publish(patch: Partial<DelegationFormState>): void {
    if (closed) return;
    state = derive({ ...state, ...patch });
    for (const listener of listeners) listener();
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
        textsVersion: state.textsVersion + 1,
      });
    },
    applyLoadError(message) {
      publish({ load: { status: "error", message } });
    },
    set(key, value) {
      publish({ draft: { ...state.draft, [key]: value }, error: null });
    },
    resetDefaults() {
      publish({
        draft: { ...DEFAULT_DELEGATION, enabled: state.draft.enabled },
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
