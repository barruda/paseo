// @vitest-environment jsdom
// CUSTOM(chat-esc-focus): Focus message input (Esc) lands in the central composer, never in the
// Project Manager composer of the Explorer sidebar, and Esc Esc interrupts the agent whose
// composer held the caret when the sequence started.

import { act, cleanup, render } from "@testing-library/react";
import React, { useCallback, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_ID_ATTRIBUTE,
  markComposerFocused,
  resetComposerFocusForTests,
} from "@/composer/focused-composer";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  SecondaryComposerProvider,
  resetEscapeOriginForTests,
  useComposerEscRouting,
} from "./esc-focus-target";

const FOCUS: KeyboardActionDefinition = { id: "message-input.focus", scope: "message-input" };
const INTERRUPT: KeyboardActionDefinition = { id: "agent.interrupt", scope: "global" };

interface FakeAgent {
  running: boolean;
  interrupted: number;
}

/** The Esc side of one composer: its input, and focus/interrupt handlers like the real one. */
function FakeComposer({ composerId, agent }: { composerId: string; agent: FakeAgent }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = React.useState(false);
  useComposerEscRouting({
    handlerId: `message-input:${composerId}`,
    composerId,
    enabled: true,
    isMessageInputFocused: focused,
    handle: (action) => {
      if (action.id === "message-input.focus") {
        inputRef.current?.focus();
        return true;
      }
      if (!agent.running) return false;
      agent.running = false;
      agent.interrupted++;
      return true;
    },
  });
  const handleFocus = useCallback(() => {
    markComposerFocused(composerId);
    setFocused(true);
  }, [composerId]);
  const handleBlur = useCallback(() => setFocused(false), []);
  const dataAttribute = { [COMPOSER_ID_ATTRIBUTE]: composerId };
  return (
    <div {...dataAttribute}>
      <textarea
        ref={inputRef}
        data-testid={`input-${composerId}`}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </div>
  );
}

const probe: { dispatch: (action: KeyboardActionDefinition) => boolean } = {
  dispatch: () => false,
};

function DispatcherProbe() {
  const dispatcher = useKeyboardActionDispatcher();
  probe.dispatch = (action) => dispatcher.dispatch(action);
  return null;
}

function setup(layout: { central?: boolean; pm?: boolean; embedded?: boolean }) {
  const agents = {
    central: { running: false, interrupted: 0 },
    pm: { running: false, interrupted: 0 },
    embedded: { running: false, interrupted: 0 },
  };
  const view = render(
    <KeyboardActionDispatcherProvider>
      <DispatcherProbe />
      {layout.central ? <FakeComposer composerId="central" agent={agents.central} /> : null}
      {layout.embedded ? <FakeComposer composerId="embedded" agent={agents.embedded} /> : null}
      {/* The sidebar mounts last, so it is the newest registration: the order that used to win. */}
      {layout.pm ? (
        <SecondaryComposerProvider>
          <FakeComposer composerId="pm" agent={agents.pm} />
        </SecondaryComposerProvider>
      ) : null}
      <button type="button" data-testid="body-button">
        body
      </button>
    </KeyboardActionDispatcherProvider>,
  );
  const input = (composerId: string) =>
    view.getByTestId(`input-${composerId}`) as HTMLTextAreaElement;
  return {
    agents,
    input,
    focus: async (composerId: string) => {
      await act(async () => input(composerId).focus());
    },
    blurAll: async () => {
      await act(async () => (document.activeElement as HTMLElement | null)?.blur());
    },
    dispatch: async (action: KeyboardActionDefinition) => {
      let handled = false;
      await act(async () => {
        handled = probe.dispatch(action);
      });
      return handled;
    },
  };
}

afterEach(() => {
  cleanup();
  resetComposerFocusForTests();
  resetEscapeOriginForTests();
});

describe("Focus message input with a central composer and the Project Manager sidebar", () => {
  it("moves the caret from the Project Manager composer to the central one", async () => {
    const { input, focus, dispatch } = setup({ central: true, pm: true });
    await focus("pm");
    expect(await dispatch(FOCUS)).toBe(true);
    expect(document.activeElement).toBe(input("central"));
  });

  it("goes to the central composer when nothing is focused", async () => {
    const { input, focus, blurAll, dispatch } = setup({ central: true, pm: true });
    await focus("pm");
    await blurAll();
    expect(document.activeElement).toBe(document.body);
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("central"));
  });

  it("keeps the caret in the central composer when it already has it", async () => {
    const { input, focus, dispatch } = setup({ central: true, pm: true });
    await focus("central");
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("central"));
  });

  it("focuses the Project Manager composer when it is the only one", async () => {
    const { input, dispatch } = setup({ pm: true });
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("pm"));
  });

  it("leaves an embedded composer alone on screen receiving the focus", async () => {
    const { input, dispatch } = setup({ embedded: true });
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("embedded"));
  });

  it("prefers an embedded composer over the Project Manager sidebar", async () => {
    const { input, focus, dispatch } = setup({ embedded: true, pm: true });
    await focus("pm");
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("embedded"));
  });
});

describe("Interrupt agent (the second Esc of Esc Esc)", () => {
  it("interrupts the Project Manager when the sequence started in its composer", async () => {
    const { agents, input, focus, dispatch } = setup({ central: true, pm: true });
    agents.central.running = true;
    agents.pm.running = true;
    await focus("pm");
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("central"));
    expect(await dispatch(INTERRUPT)).toBe(true);
    expect(agents.pm.interrupted).toBe(1);
    expect(agents.central.interrupted).toBe(0);
  });

  it("interrupts the central agent when the sequence started there", async () => {
    const { agents, focus, dispatch } = setup({ central: true, pm: true });
    agents.central.running = true;
    agents.pm.running = true;
    await focus("central");
    await dispatch(FOCUS);
    await dispatch(INTERRUPT);
    expect(agents.central.interrupted).toBe(1);
    expect(agents.pm.interrupted).toBe(0);
  });

  it("never falls through to the Project Manager from the central composer", async () => {
    const { agents, focus, dispatch } = setup({ central: true, pm: true });
    agents.pm.running = true;
    await focus("central");
    await dispatch(FOCUS);
    expect(await dispatch(INTERRUPT)).toBe(false);
    expect(agents.pm.interrupted).toBe(0);
  });

  it("interrupts the Project Manager while its composer holds the caret", async () => {
    const { agents, focus, dispatch } = setup({ central: true, pm: true });
    agents.central.running = true;
    agents.pm.running = true;
    await focus("pm");
    await dispatch(INTERRUPT);
    expect(agents.pm.interrupted).toBe(1);
    expect(agents.central.interrupted).toBe(0);
  });
});
