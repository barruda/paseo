// @vitest-environment jsdom
// CUSTOM(chat-esc-focus): Focus message input (Esc) lands in the central composer, never in the
// Project Manager composer of the Explorer sidebar. Esc Esc interrupts the agent whose composer
// held the caret when the sequence started, except the Project Manager: from its composer Esc Esc
// only moves the caret. An agent dragged into Explorer still stops on Esc Esc.

import { act, cleanup, render, renderHook } from "@testing-library/react";
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
  useComposerAutoFocus,
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

function setup(layout: { central?: boolean; pm?: boolean; docked?: boolean; embedded?: boolean }) {
  const agents = {
    central: { running: false, interrupted: 0 },
    pm: { running: false, interrupted: 0 },
    docked: { running: false, interrupted: 0 },
    embedded: { running: false, interrupted: 0 },
  };
  const view = render(
    <KeyboardActionDispatcherProvider>
      <DispatcherProbe />
      {layout.central ? <FakeComposer composerId="central" agent={agents.central} /> : null}
      {layout.embedded ? <FakeComposer composerId="embedded" agent={agents.embedded} /> : null}
      {/* The sidebar mounts last, so it is the newest registration: the order that used to win. */}
      {layout.pm ? (
        <SecondaryComposerProvider interruptsOnEsc={false} autoFocus={false}>
          <FakeComposer composerId="pm" agent={agents.pm} />
        </SecondaryComposerProvider>
      ) : null}
      {/* An agent dragged into Explorer: a side panel that still stops on Esc Esc. */}
      {layout.docked ? (
        <SecondaryComposerProvider>
          <FakeComposer composerId="docked" agent={agents.docked} />
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

describe("Esc and Esc Esc from the Project Manager composer", () => {
  it("Esc moves the caret to the central composer and the Project Manager keeps running", async () => {
    const { agents, input, focus, dispatch } = setup({ central: true, pm: true });
    agents.pm.running = true;
    await focus("pm");
    expect(await dispatch(FOCUS)).toBe(true);
    expect(document.activeElement).toBe(input("central"));
    expect(agents.pm).toEqual({ running: true, interrupted: 0 });
  });

  it("Esc Esc moves the caret too, and stops neither the Project Manager nor the central agent", async () => {
    const { agents, input, focus, dispatch } = setup({ central: true, pm: true });
    agents.central.running = true;
    agents.pm.running = true;
    await focus("pm");
    await dispatch(FOCUS);
    // The second Esc is swallowed: the central composer that just took the caret does not act.
    expect(await dispatch(INTERRUPT)).toBe(true);
    expect(document.activeElement).toBe(input("central"));
    expect(agents.pm).toEqual({ running: true, interrupted: 0 });
    expect(agents.central).toEqual({ running: true, interrupted: 0 });
  });

  it("Esc Esc with the caret still in the Project Manager composer does not stop it", async () => {
    const { agents, focus, dispatch } = setup({ central: true, pm: true });
    agents.pm.running = true;
    await focus("pm");
    await dispatch(INTERRUPT);
    expect(agents.pm).toEqual({ running: true, interrupted: 0 });
  });

  it("Esc Esc in the central composer still stops the central agent, not the Project Manager", async () => {
    const { agents, focus, dispatch } = setup({ central: true, pm: true });
    agents.central.running = true;
    agents.pm.running = true;
    await focus("central");
    await dispatch(FOCUS);
    expect(await dispatch(INTERRUPT)).toBe(true);
    expect(agents.central.interrupted).toBe(1);
    expect(agents.pm).toEqual({ running: true, interrupted: 0 });
  });

  it("does not stop the Project Manager when it is the only composer on screen", async () => {
    const { agents, focus, dispatch } = setup({ pm: true });
    agents.pm.running = true;
    await focus("pm");
    await dispatch(FOCUS);
    await dispatch(INTERRUPT);
    expect(agents.pm).toEqual({ running: true, interrupted: 0 });
  });
});

describe("Composer autofocus under a side panel", () => {
  const autoFocusUnder = (props: { autoFocus?: boolean } | null) =>
    renderHook(() => useComposerAutoFocus(true), {
      wrapper: props
        ? ({ children }) => (
            <SecondaryComposerProvider {...props}>{children}</SecondaryComposerProvider>
          )
        : undefined,
    }).result.current;

  it("keeps a composer's own autoFocus outside the Project Manager tab", () => {
    expect(autoFocusUnder(null)).toBe(true);
    expect(autoFocusUnder({})).toBe(true);
  });

  it("turns it off in the Project Manager tab, so a remount never takes the caret", () => {
    expect(autoFocusUnder({ autoFocus: false })).toBe(false);
  });

  it("still honors a later focus request there (a file attached to the composer)", () => {
    const { result, rerender } = renderHook(({ key }) => useComposerAutoFocus(true, key), {
      initialProps: { key: "0" },
      wrapper: ({ children }) => (
        <SecondaryComposerProvider autoFocus={false}>{children}</SecondaryComposerProvider>
      ),
    });
    expect(result.current).toBe(false);
    rerender({ key: "1" });
    expect(result.current).toBe(true);
  });
});

describe("Interrupt agent (the second Esc of Esc Esc) with an agent docked in Explorer", () => {
  it("interrupts a docked agent when the sequence started in its composer", async () => {
    const { agents, input, focus, dispatch } = setup({ central: true, docked: true });
    agents.central.running = true;
    agents.docked.running = true;
    await focus("docked");
    await dispatch(FOCUS);
    expect(document.activeElement).toBe(input("central"));
    expect(await dispatch(INTERRUPT)).toBe(true);
    expect(agents.docked.interrupted).toBe(1);
    expect(agents.central.interrupted).toBe(0);
  });

  it("interrupts the central agent when the sequence started there", async () => {
    const { agents, focus, dispatch } = setup({ central: true, docked: true });
    agents.central.running = true;
    agents.docked.running = true;
    await focus("central");
    await dispatch(FOCUS);
    await dispatch(INTERRUPT);
    expect(agents.central.interrupted).toBe(1);
    expect(agents.docked.interrupted).toBe(0);
  });

  it("never falls through to a docked agent from the central composer", async () => {
    const { agents, focus, dispatch } = setup({ central: true, docked: true });
    agents.docked.running = true;
    await focus("central");
    await dispatch(FOCUS);
    expect(await dispatch(INTERRUPT)).toBe(false);
    expect(agents.docked.interrupted).toBe(0);
  });

  it("interrupts a docked agent while its composer holds the caret", async () => {
    const { agents, focus, dispatch } = setup({ central: true, docked: true });
    agents.central.running = true;
    agents.docked.running = true;
    await focus("docked");
    await dispatch(INTERRUPT);
    expect(agents.docked.interrupted).toBe(1);
    expect(agents.central.interrupted).toBe(0);
  });
});
