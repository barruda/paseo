// @vitest-environment jsdom
// CUSTOM(model-picker-focus): Ctrl+M and ←/→ act on the composer holding the caret, not on
// whichever composer registered its handler last (the central tab, with the Project Manager
// open in the right sidebar).

import { act, cleanup, render } from "@testing-library/react";
import React, { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentControlCommandCenterSource } from "@/command-center/agent-control-registration";
import {
  COMPOSER_ID_ATTRIBUTE,
  isComposerKeyboardTarget,
  resetComposerFocusForTests,
} from "@/composer/focused-composer";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useModelPickerStore } from "./store";
import { useModelPickerSource } from "./use-model-picker-source";

type Dispatch = (action: KeyboardActionDefinition) => boolean;

function controlsFor(ownerKey: string): AgentControlCommandCenterSource {
  return {
    serverId: "s1",
    ownerKey,
    provider: "claude",
    providerDefinitions: [],
    models: { providers: [], selectedProvider: "claude", selectedModelId: "opus", select: vi.fn() },
    thinking: { options: [], selectedId: "high", select: vi.fn() },
    optionControls: null,
  };
}

/** The keyboard side of one composer: the picker source and the ←/→ cycle handler. */
function FakeComposer({
  composerId,
  controls,
  cycles,
}: {
  composerId: string;
  controls: AgentControlCommandCenterSource;
  /** The ←/→ actions this composer handled. */
  cycles: string[];
}) {
  const isActive = useCallback(() => isComposerKeyboardTarget(composerId), [composerId]);
  useModelPickerSource({ sourceId: composerId, enabled: true, controls, isActive });
  useKeyboardActionHandler({
    handlerId: `cycle:${composerId}`,
    actions: ["task.draft.model", "task.draft.effort"],
    enabled: true,
    priority: 200,
    isActive,
    handle: (action) => {
      cycles.push(action.id);
      return true;
    },
  });
  const dataAttribute = { [COMPOSER_ID_ATTRIBUTE]: composerId };
  return (
    <div {...dataAttribute}>
      <textarea data-testid={`input-${composerId}`} />
    </div>
  );
}

const probe: { dispatch: Dispatch } = { dispatch: () => false };

function DispatcherProbe() {
  const dispatcher = useKeyboardActionDispatcher();
  probe.dispatch = (action) => dispatcher.dispatch(action);
  return null;
}

function setup() {
  const central = { controls: controlsFor("central"), cycles: [] as string[] };
  const pm = { controls: controlsFor("pm"), cycles: [] as string[] };
  const view = render(
    <KeyboardActionDispatcherProvider>
      <DispatcherProbe />
      {/* The sidebar composer mounts first, so the central tab is the newest registration. */}
      <FakeComposer composerId="pm" controls={pm.controls} cycles={pm.cycles} />
      <FakeComposer composerId="central" controls={central.controls} cycles={central.cycles} />
    </KeyboardActionDispatcherProvider>,
  );
  const focus = (composerId: string) =>
    act(() => (view.getByTestId(`input-${composerId}`) as HTMLTextAreaElement).focus());
  return {
    central,
    pm,
    focus,
    dispatch: (action: KeyboardActionDefinition) => probe.dispatch(action),
  };
}

afterEach(() => {
  cleanup();
  resetComposerFocusForTests();
  useModelPickerStore.getState().close();
});

describe("model picker target", () => {
  it("opens Ctrl+M on the Project Manager composer when its input has the caret", () => {
    const { pm, focus, dispatch } = setup();
    focus("pm");
    act(() => {
      dispatch({ id: "message-input.model-picker", scope: "message-input" });
    });
    expect(useModelPickerStore.getState().sourceId).toBe("pm");
    expect(useModelPickerStore.getState().controls).toBe(pm.controls);
  });

  it("opens Ctrl+M on the central composer when its input has the caret", () => {
    const { central, focus, dispatch } = setup();
    focus("pm");
    focus("central");
    act(() => {
      dispatch({ id: "message-input.model-picker", scope: "message-input" });
    });
    expect(useModelPickerStore.getState().sourceId).toBe("central");
    expect(useModelPickerStore.getState().controls).toBe(central.controls);
  });
});

describe("←/→ with the picker closed", () => {
  it("never reach the picker, and only the focused composer sees them", () => {
    const { central, pm, focus, dispatch } = setup();
    focus("pm");
    act(() => {
      dispatch({ id: "task.draft.model", scope: "message-input" });
      dispatch({ id: "task.draft.effort", scope: "message-input" });
    });
    expect(useModelPickerStore.getState().sourceId).toBeNull();
    expect(pm.cycles).toEqual(["task.draft.model", "task.draft.effort"]);
    expect(central.cycles).toEqual([]);
    expect(central.controls.models.select).not.toHaveBeenCalled();
    expect(central.controls.thinking.select).not.toHaveBeenCalled();
  });
});
