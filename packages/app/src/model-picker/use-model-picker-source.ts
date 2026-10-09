import { useCallback, useEffect, useRef } from "react";
import type { AgentControlCommandCenterSource } from "@/command-center/agent-control-registration";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useModelPickerStore } from "./store";

const MODEL_PICKER_ACTIONS = ["message-input.model-picker"] as const;

/**
 * Connects one composer's model and effort controls to the model picker: Shift+Tab in the active
 * composer opens the picker on it, the picker sees its controls live while open, and an effort
 * chosen together with a new model is applied once the composer has switched to that model.
 */
export function useModelPickerSource(input: {
  sourceId: string;
  enabled: boolean;
  controls: AgentControlCommandCenterSource;
}): void {
  const { sourceId, enabled, controls } = input;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const handle = useCallback(
    (action: KeyboardActionDefinition) => {
      if (action.id !== "message-input.model-picker") return false;
      useModelPickerStore.getState().open(sourceId, controlsRef.current);
      return true;
    },
    [sourceId],
  );
  useKeyboardActionHandler({
    handlerId: `model-picker:${sourceId}`,
    actions: MODEL_PICKER_ACTIONS,
    enabled,
    priority: 200,
    handle,
  });

  const isOpenHere = useModelPickerStore((state) => state.sourceId === sourceId);
  useEffect(() => {
    if (isOpenHere) useModelPickerStore.getState().update(sourceId, controls);
  }, [controls, isOpenHere, sourceId]);

  const pending = useModelPickerStore((state) =>
    state.pendingEffort?.sourceId === sourceId ? state.pendingEffort : null,
  );
  const { selectedProvider, selectedModelId } = controls.models;
  const { options: thinkingOptions, selectedId: selectedThinkingId, select } = controls.thinking;
  useEffect(() => {
    if (!pending) return;
    const store = useModelPickerStore.getState();
    if (Date.now() > pending.expiresAt) {
      store.setPendingEffort(null);
      return;
    }
    if (selectedProvider !== pending.provider || selectedModelId !== pending.modelId) return;
    if (!thinkingOptions?.some((option) => option.id === pending.effortId)) return;
    store.setPendingEffort(null);
    if (selectedThinkingId !== pending.effortId) void select(pending.effortId);
  }, [pending, select, selectedModelId, selectedProvider, selectedThinkingId, thinkingOptions]);
}
