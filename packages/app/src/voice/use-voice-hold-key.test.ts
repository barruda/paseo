/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/constants/platform", () => ({ isWeb: true }));

import { useVoiceHoldKey, VOICE_OVERLAY_TEST_ID } from "./use-voice-hold-key";
import type { VoiceRuntime } from "./voice-runtime";

function mount() {
  const setHold = vi.fn();
  const runtime = { canHold: () => true, setHold } as unknown as VoiceRuntime;
  const hook = renderHook(() => useVoiceHoldKey(runtime));
  return { setHold, unmount: hook.unmount };
}

function press(target: HTMLElement, key: string) {
  const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(down);
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  return down;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("holds with Space and Enter while a button outside the voice composer has focus", () => {
  const { setHold, unmount } = mount();
  const button = document.createElement("button");
  document.body.append(button);
  expect(press(button, " ").defaultPrevented).toBe(true);
  press(button, "Enter");
  expect(setHold.mock.calls).toEqual([[true], [false], [true], [false]]);
  unmount();
});

it("holds from the composer text field hidden under the voice overlay, and the field never sees the key", () => {
  const { setHold, unmount } = mount();
  document.body.innerHTML = `<div data-testid="message-input-root"><textarea></textarea><div data-testid="${VOICE_OVERLAY_TEST_ID}"></div></div>`;
  const textarea = document.querySelector("textarea")!;
  const seen = vi.fn();
  textarea.addEventListener("keydown", seen);
  press(textarea, "Enter");
  expect(seen).not.toHaveBeenCalled();
  expect(setHold.mock.calls).toEqual([[true], [false]]);
  unmount();
});

it("leaves the keys to another text field, such as a terminal", () => {
  const { setHold, unmount } = mount();
  const textarea = document.createElement("textarea");
  document.body.append(textarea);
  expect(press(textarea, " ").defaultPrevented).toBe(false);
  expect(setHold).not.toHaveBeenCalled();
  unmount();
});
