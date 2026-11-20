import { afterEach, expect, it, vi } from "vitest";
import { Platform } from "react-native";
import { onEscapeKey } from "../client/web";

const listeners = new Map<string, (event: any) => void>();
const originalOS = Platform.OS;

function fakeDocument() {
  return {
    addEventListener: (name: string, callback: (event: any) => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string, callback: (event: any) => void) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
}

afterEach(() => {
  listeners.clear();
  delete (globalThis as { document?: unknown }).document;
  Platform.OS = originalOS;
});

it("closes on Escape and leaves other keys alone", () => {
  Platform.OS = "web";
  (globalThis as { document?: unknown }).document = fakeDocument();
  const close = vi.fn();
  const dispose = onEscapeKey(close);
  listeners.get("keydown")!({
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  expect(close).not.toHaveBeenCalled();
  listeners.get("keydown")!({
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  expect(close).toHaveBeenCalledOnce();
  dispose();
  expect(listeners.has("keydown")).toBe(false);
});
