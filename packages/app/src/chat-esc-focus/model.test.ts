import { describe, expect, it } from "vitest";
import {
  isPlainEnter,
  isPlainEscape,
  shouldEnterFocusComposer,
  shouldReachBottomFocusComposer,
  shouldReturnToComposer,
  type EscapeKeyInput,
} from "./model";

const escape: EscapeKeyInput = {
  key: "Escape",
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
};

describe("isPlainEscape", () => {
  it("accepts a plain Escape press", () => {
    expect(isPlainEscape(escape)).toBe(true);
  });

  it("rejects other keys, modifiers, repeats, and handled events", () => {
    expect(isPlainEscape({ ...escape, key: "Enter" })).toBe(false);
    expect(isPlainEscape({ ...escape, shiftKey: true })).toBe(false);
    expect(isPlainEscape({ ...escape, ctrlKey: true })).toBe(false);
    expect(isPlainEscape({ ...escape, metaKey: true })).toBe(false);
    expect(isPlainEscape({ ...escape, altKey: true })).toBe(false);
    expect(isPlainEscape({ ...escape, repeat: true })).toBe(false);
    expect(isPlainEscape({ ...escape, defaultPrevented: true })).toBe(false);
  });
});

describe("shouldReturnToComposer", () => {
  it("returns to the composer when chat text is selected and nothing else owns focus", () => {
    expect(shouldReturnToComposer({ hasTimelineSelection: true, focus: "body" })).toBe(true);
    expect(shouldReturnToComposer({ hasTimelineSelection: true, focus: "timeline" })).toBe(true);
    expect(shouldReturnToComposer({ hasTimelineSelection: true, focus: "ancestor" })).toBe(true);
  });

  it("leaves Esc alone without a chat selection", () => {
    expect(shouldReturnToComposer({ hasTimelineSelection: false, focus: "body" })).toBe(false);
  });

  it("leaves Esc to inputs, menus, and dialogs", () => {
    expect(shouldReturnToComposer({ hasTimelineSelection: true, focus: "editable" })).toBe(false);
    expect(shouldReturnToComposer({ hasTimelineSelection: true, focus: "other" })).toBe(false);
  });
});

describe("isPlainEnter", () => {
  const enter = { ...escape, key: "Enter", isComposing: false };
  it("accepts a plain Enter and rejects IME, modifiers, and handled events", () => {
    expect(isPlainEnter(enter)).toBe(true);
    expect(isPlainEnter({ ...enter, isComposing: true })).toBe(false);
    expect(isPlainEnter({ ...enter, shiftKey: true })).toBe(false);
    expect(isPlainEnter({ ...enter, defaultPrevented: true })).toBe(false);
    expect(isPlainEnter({ ...enter, key: "Escape" })).toBe(false);
  });
});

describe("shouldEnterFocusComposer", () => {
  it("focuses from inside the chat, or with nothing focused in the chat last used", () => {
    expect(shouldEnterFocusComposer({ focus: "timeline", isLastInteracted: false })).toBe(true);
    expect(shouldEnterFocusComposer({ focus: "body", isLastInteracted: true })).toBe(true);
    expect(shouldEnterFocusComposer({ focus: "ancestor", isLastInteracted: true })).toBe(true);
  });

  it("leaves Enter to other chats, inputs, menus, and dialogs", () => {
    expect(shouldEnterFocusComposer({ focus: "body", isLastInteracted: false })).toBe(false);
    expect(shouldEnterFocusComposer({ focus: "editable", isLastInteracted: true })).toBe(false);
    expect(shouldEnterFocusComposer({ focus: "other", isLastInteracted: true })).toBe(false);
  });
});

describe("shouldReachBottomFocusComposer", () => {
  const reached = {
    wasNearBottom: false,
    isNearBottom: true,
    hasTimelineSelection: false,
    focus: "body" as const,
    isLastInteracted: true,
  };
  it("focuses when the chat the user scrolled comes back to the bottom", () => {
    expect(shouldReachBottomFocusComposer(reached)).toBe(true);
  });

  it("ignores staying at the bottom, leaving it, selections, other chats, and other focus", () => {
    expect(shouldReachBottomFocusComposer({ ...reached, wasNearBottom: true })).toBe(false);
    expect(shouldReachBottomFocusComposer({ ...reached, isNearBottom: false })).toBe(false);
    expect(shouldReachBottomFocusComposer({ ...reached, hasTimelineSelection: true })).toBe(false);
    expect(shouldReachBottomFocusComposer({ ...reached, isLastInteracted: false })).toBe(false);
    expect(shouldReachBottomFocusComposer({ ...reached, focus: "editable" })).toBe(false);
  });
});
