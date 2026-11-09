// CUSTOM(jev-router): registers Effort focused's locked ←/→ on one composer (a running agent's or
// a draft's). It runs before the regular cycling handlers and only claims the key while the lock
// is on; otherwise they cycle favorites as before.

import type { AgentControlCommandCenterSource } from "@/command-center/agent-control-registration";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { PENDING_EFFORT_TTL_MS, useModelPickerStore } from "@/model-picker/store";
import { handleLockedCycleKey, isFocusedComposerCaretAtEnd, isFocusedComposerEmpty } from "./cycle";

const CYCLE_ACTIONS = ["task.draft.model", "task.draft.effort"] as const;

export function useLockedCycleKeys(input: {
  /** The composer's model-picker source id: a new model's effort waits for it there. */
  sourceId: string;
  enabled: boolean;
  controls: AgentControlCommandCenterSource;
}): void {
  const { sourceId, controls } = input;
  useKeyboardActionHandler({
    handlerId: `jev-locked-cycle:${sourceId}`,
    actions: CYCLE_ACTIONS,
    enabled: input.enabled,
    priority: 210,
    handle: (action) => {
      // ← only in an empty composer; → also with text when the caret is at the end.
      const keyApplies =
        action.id === "task.draft.model" ? isFocusedComposerEmpty() : isFocusedComposerCaretAtEnd();
      if (!keyApplies) return false;
      return handleLockedCycleKey({
        actionId: action.id,
        serverId: controls.serverId,
        provider: controls.models.selectedProvider,
        modelId: controls.models.selectedModelId ?? null,
        effortId: controls.thinking.selectedId ?? null,
        selectModelAndEffort: (model, effort) => {
          // The effort applies once the composer reports the new model (as Ctrl+M does).
          useModelPickerStore.getState().setPendingEffort({
            sourceId,
            provider: "claude",
            modelId: model,
            effortId: effort,
            expiresAt: Date.now() + PENDING_EFFORT_TTL_MS,
          });
          void controls.models.select("claude", model);
        },
        selectEffort: (effort) => void controls.thinking.select(effort),
      });
    },
  });
}
