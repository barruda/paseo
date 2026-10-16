import { describe, expect, it } from "vitest";
import { isPlainEscape, shouldReturnToComposer, type EscapeKeyInput } from "./model";

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
