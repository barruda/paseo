import { expect, it } from "vitest";
import { createKeyboardActionDispatcher } from "./keyboard-action-dispatcher";
import {
  buildEffectiveBindings,
  resolveKeyboardShortcut,
  type ChordState,
} from "./keyboard-shortcuts";
import { dispatchVoiceEscape } from "./voice-escape";

it.each(["Escape", "Escape Escape"])(
  "exits on first Escape and interrupts on second with %s",
  (combo) => {
    const dispatcher = createKeyboardActionDispatcher();
    const calls: string[] = [];
    let voiceActive = true;
    dispatcher.registerHandler({
      handlerId: "composer",
      actions: ["message-input.voice-exit", "agent.interrupt"],
      enabled: true,
      priority: 100,
      isActive: () => true,
      handle(action) {
        if (action.id === "message-input.voice-exit") {
          if (!voiceActive) return false;
          voiceActive = false;
          calls.push("exit");
          return true;
        }
        calls.push("interrupt");
        return true;
      },
    });
    let chordState: ChordState = { candidateIndices: [], step: 0, timeoutId: null };
    const event = {
      key: "Escape",
      code: "Escape",
      repeat: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    };
    function press() {
      const exited = dispatchVoiceEscape(event, (action) => dispatcher.dispatch(action));
      const result = resolveKeyboardShortcut({
        event,
        context: {
          isMac: false,
          isDesktop: true,
          focusScope: "message-input",
          commandCenterOpen: false,
        },
        chordState,
        onChordReset: () => {},
        bindings: buildEffectiveBindings({ "agent-interrupt": combo }),
      });
      chordState = result.nextChordState;
      if (!exited && result.match?.action === "agent.interrupt")
        dispatcher.dispatch({ id: "agent.interrupt", scope: "global" });
    }
    press();
    expect(calls).toEqual(["exit"]);
    press();
    expect(calls).toEqual(["exit", "interrupt"]);
    if (chordState.timeoutId) clearTimeout(chordState.timeoutId);
  },
);

it("leaves modified Escape and key repeat alone", () => {
  let calls = 0;
  const dispatch = () => {
    calls++;
    return true;
  };
  const event = {
    key: "Escape",
    code: "Escape",
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
  };
  expect(dispatchVoiceEscape({ ...event, repeat: true }, dispatch)).toBe(false);
  expect(dispatchVoiceEscape({ ...event, ctrlKey: true }, dispatch)).toBe(false);
  expect(calls).toBe(0);
});
