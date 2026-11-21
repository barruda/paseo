import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import type { PendingPermission } from "@/types/shared";
import { QuestionFormCard } from "./question-form-card";

// Load translations so controls expose their real accessible names.
void testI18n;

// The Markdown engine does not load in this harness; question and option text are covered by
// e2e/browser/question-prompt-pagination.spec.ts. Plain text keeps these tests on the answers.
vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <span>{text}</span>,
}));

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * A real browser with the real web `EditingTextInput`, because the bug under test lives in the
 * gap between that input and React state: the input owns its text and never replays state, so a
 * card that drops the Other text from state alone keeps showing it while submit ignores it.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

type QuestionInput = Record<string, unknown>;

function buildPermission(questions: QuestionInput[]): PendingPermission {
  return {
    key: "perm-1",
    agentId: "agent-1",
    request: {
      id: "perm-1",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: { questions },
    },
  };
}

function mountCard(question: QuestionInput | QuestionInput[]) {
  const questions = Array.isArray(question) ? question : [question];
  const onRespond = vi.fn<(response: AgentPermissionResponse) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QuestionFormCard
        permission={buildPermission(questions)}
        onRespond={onRespond}
        isResponding={false}
        responseError={null}
      />,
    ),
  );
  mounted.push({ root, container });

  const view = within(container);
  const option = (label: string) =>
    view.queryByRole("radio", { name: label }) ?? view.getByRole("checkbox", { name: label });
  const otherInput = () => view.getByRole<HTMLInputElement>("textbox");
  const check = (label: string) => act(() => option(label).click());
  const pressEnter = (label: string) => {
    const target = option(label);
    act(() => {
      target.focus();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    });
  };
  const currentQuestion = () => view.getByTestId("question-form-current-question").textContent;
  const openTab = (index: number) =>
    act(() => view.getByRole("tab", { name: `Question ${index} of ${questions.length}` }).click());
  const type = (text: string) => {
    const input = otherInput();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("HTML input value setter is unavailable");
    act(() => {
      valueSetter.call(input, text);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    });
  };
  const submit = () => act(() => view.getByRole("button", { name: "Submit" }).click());
  const submittedAnswers = (): Record<string, string> => {
    const response = onRespond.mock.calls[0]?.[0];
    if (!response || response.behavior !== "allow") throw new Error("card did not submit");
    return (response.updatedInput as { answers: Record<string, string> }).answers;
  };
  return {
    check,
    pressEnter,
    type,
    otherInput,
    submit,
    submittedAnswers,
    currentQuestion,
    openTab,
    onRespond,
    view,
  };
}

const multiSelectQuestion = {
  question: "Which fruits do you like?",
  header: "Fruits",
  options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }],
  multiSelect: true,
  allowOther: true,
};

const singleSelectQuestion = {
  question: "Which provider?",
  header: "Provider",
  options: [{ label: "Claude Code" }, { label: "Codex" }],
  multiSelect: false,
  allowOther: true,
};

describe("QuestionFormCard other answers", () => {
  it("keeps checked options when the other answer is typed afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.check("Apple");
    card.check("Cherry");
    card.type("durian");
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Cherry, durian" });
  });

  it("keeps the typed other answer when options are checked afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.type("durian");
    card.check("Apple");
    card.check("Banana");

    expect(card.otherInput().value).toBe("durian");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Banana, durian" });
  });

  it("sends the typed other answer with Submit (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.type("OpenCode");
    expect(card.onRespond).not.toHaveBeenCalled();
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Provider: "OpenCode" });
  });

  it("clears the typed other answer and sends the option picked afterwards (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.type("OpenCode");
    card.check("Codex");

    expect(card.otherInput().value).toBe("");
    expect(card.onRespond).toHaveBeenCalledTimes(1);
    expect(card.submittedAnswers()).toEqual({ Provider: "Codex" });
  });
});

const surfaceQuestion = {
  question: "Which surface?",
  header: "Surface",
  options: [{ label: "App" }, { label: "CLI" }],
  multiSelect: false,
};

const rolloutQuestion = {
  question: "How to roll out?",
  header: "Rollout",
  options: [{ label: "Everyone" }, { label: "Behind flag" }],
  multiSelect: false,
};

// CUSTOM(question-click-to-answer): single-select options answer on click, without Submit.
describe("QuestionFormCard click to answer", () => {
  it("sends a lone single-select question on the option click", () => {
    const card = mountCard(surfaceQuestion);

    card.check("CLI");

    expect(card.onRespond).toHaveBeenCalledTimes(1);
    expect(card.submittedAnswers()).toEqual({ Surface: "CLI" });
  });

  it("sends a lone single-select question on Enter in the focused option", () => {
    const card = mountCard(surfaceQuestion);

    card.pressEnter("App");

    expect(card.onRespond).toHaveBeenCalledTimes(1);
    expect(card.submittedAnswers()).toEqual({ Surface: "App" });
  });

  it("moves to the next question on click and sends every answer from the last one", () => {
    const card = mountCard([surfaceQuestion, rolloutQuestion]);

    card.check("App");
    expect(card.onRespond).not.toHaveBeenCalled();
    expect(card.currentQuestion()).toBe("How to roll out?");

    card.openTab(1);
    card.check("CLI");
    expect(card.onRespond).not.toHaveBeenCalled();
    expect(card.currentQuestion()).toBe("How to roll out?");

    card.check("Behind flag");
    expect(card.onRespond).toHaveBeenCalledTimes(1);
    expect(card.submittedAnswers()).toEqual({ Surface: "CLI", Rollout: "Behind flag" });
  });

  it("opens the first unanswered question instead of sending when the last is answered first", () => {
    const card = mountCard([surfaceQuestion, rolloutQuestion]);

    card.openTab(2);
    card.check("Everyone");

    expect(card.onRespond).not.toHaveBeenCalled();
    expect(card.currentQuestion()).toBe("Which surface?");
    card.check("App");
    expect(card.onRespond).not.toHaveBeenCalled();
    expect(card.currentQuestion()).toBe("How to roll out?");
    card.check("Everyone");
    expect(card.submittedAnswers()).toEqual({ Surface: "App", Rollout: "Everyone" });
  });

  it("keeps multi-select on Submit", () => {
    const card = mountCard({ ...multiSelectQuestion, allowOther: false });

    card.check("Apple");
    card.check("Banana");
    expect(card.onRespond).not.toHaveBeenCalled();

    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Banana" });
  });

  it("waits for Submit on a free-write last question after single-select clicks", () => {
    const card = mountCard([
      surfaceQuestion,
      { question: "Anything else?", header: "Notes", options: [], multiSelect: false },
    ]);

    card.check("App");
    expect(card.currentQuestion()).toBe("Anything else?");
    card.type("Ship it");
    expect(card.onRespond).not.toHaveBeenCalled();

    card.submit();
    expect(card.submittedAnswers()).toEqual({ Surface: "App", Notes: "Ship it" });
  });
});

// Upstream's explicit-navigation checks, kept for the answers that still wait for Next/Submit:
// multi-select, and a description click that only selects.
describe("QuestionFormCard explicit navigation", () => {
  it("keeps picked options visible until Next and submits only on Submit (multi-select)", () => {
    const card = mountCard([multiSelectQuestion, { ...multiSelectQuestion, header: "More" }]);
    card.check("Apple");
    expect(card.view.getByRole("checkbox", { name: "Apple" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(card.onRespond).not.toHaveBeenCalled();
    act(() => card.view.getByRole("button", { name: "Next" }).click());
    card.check("Banana");
    expect(card.onRespond).not.toHaveBeenCalled();
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple", More: "Banana" });
  });

  it("selects an option when its description is clicked without submitting (multi-select)", () => {
    const card = mountCard({
      ...multiSelectQuestion,
      options: [{ label: "Apple", description: "A red fruit" }],
    });
    act(() => card.view.getByText("A red fruit").click());
    expect(card.view.getByRole("checkbox", { name: "Apple" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(card.onRespond).not.toHaveBeenCalled();
  });
});
