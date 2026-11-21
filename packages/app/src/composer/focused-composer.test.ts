// @vitest-environment jsdom
// CUSTOM(model-picker-focus)

import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_ID_ATTRIBUTE,
  isComposerKeyboardTarget,
  markComposerFocused,
  releaseComposerFocus,
  resetComposerFocusForTests,
  resolveKeyboardTargetComposerId,
} from "./focused-composer";

function mountComposer(composerId: string): { root: HTMLElement; textarea: HTMLTextAreaElement } {
  const root = document.createElement("div");
  root.setAttribute(COMPOSER_ID_ATTRIBUTE, composerId);
  const textarea = document.createElement("textarea");
  root.appendChild(textarea);
  document.body.appendChild(root);
  return { root, textarea };
}

afterEach(() => {
  resetComposerFocusForTests();
  document.body.innerHTML = "";
});

describe("resolveKeyboardTargetComposerId", () => {
  it("is the composer holding the focused element", () => {
    const central = mountComposer("central");
    const pm = mountComposer("pm");
    markComposerFocused("central");

    pm.textarea.focus();
    expect(resolveKeyboardTargetComposerId()).toBe("pm");
    expect(isComposerKeyboardTarget("pm")).toBe(true);
    expect(isComposerKeyboardTarget("central")).toBe(false);

    central.textarea.focus();
    expect(resolveKeyboardTargetComposerId()).toBe("central");
    expect(isComposerKeyboardTarget("pm")).toBe(false);
  });

  it("counts a toolbar control inside the composer", () => {
    const pm = mountComposer("pm");
    mountComposer("central");
    const chip = document.createElement("button");
    pm.root.appendChild(chip);
    chip.focus();
    expect(resolveKeyboardTargetComposerId()).toBe("pm");
  });

  it("falls back to the composer focused last when focus is outside every composer", () => {
    mountComposer("central");
    mountComposer("pm");
    markComposerFocused("pm");
    expect(resolveKeyboardTargetComposerId()).toBe("pm");
    expect(isComposerKeyboardTarget("central")).toBe(false);
  });

  it("forgets a released composer and then lets any composer act", () => {
    markComposerFocused("pm");
    releaseComposerFocus("central");
    expect(resolveKeyboardTargetComposerId()).toBe("pm");
    releaseComposerFocus("pm");
    expect(resolveKeyboardTargetComposerId()).toBeNull();
    expect(isComposerKeyboardTarget("central")).toBe(true);
  });
});
