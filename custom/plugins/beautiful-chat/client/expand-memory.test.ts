import { describe, expect, it } from "vitest";
import { createExpandMemory } from "./expand-memory";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("createExpandMemory", () => {
  it("starts every kind closed", () => {
    const memory = createExpandMemory(() => memoryStorage());
    expect(memory.isExpanded("thinking")).toBe(false);
    expect(memory.isExpanded("bash")).toBe(false);
  });

  it("remembers each kind separately", () => {
    const memory = createExpandMemory(() => memoryStorage());
    memory.remember("thinking", true);
    expect(memory.isExpanded("thinking")).toBe(true);
    expect(memory.isExpanded("edit")).toBe(false);
    memory.remember("thinking", false);
    expect(memory.isExpanded("thinking")).toBe(false);
  });

  it("shares choices through storage", () => {
    const storage = memoryStorage();
    createExpandMemory(() => storage).remember("edit", true);
    expect(createExpandMemory(() => storage).isExpanded("edit")).toBe(true);
  });

  it("ignores stored values that are not booleans", () => {
    const storage = memoryStorage({
      "paseo/beautiful-chat/expanded/v1": JSON.stringify({ bash: "yes", edit: true }),
    });
    const memory = createExpandMemory(() => storage);
    expect(memory.isExpanded("bash")).toBe(false);
    expect(memory.isExpanded("edit")).toBe(true);
  });

  it("keeps choices for the session when storage is missing or throws", () => {
    const missing = createExpandMemory(() => undefined);
    missing.remember("read", true);
    expect(missing.isExpanded("read")).toBe(true);

    const broken = createExpandMemory(() => {
      throw new Error("storage disabled");
    });
    broken.remember("read", true);
    expect(broken.isExpanded("read")).toBe(true);
  });
});
