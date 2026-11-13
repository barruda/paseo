// CUSTOM(background-tools)
import { describe, expect, test } from "vitest";
import {
  backgroundToolCopyText,
  backgroundToolKindLabel,
  formatBackgroundToolCount,
  hasBackgroundTools,
} from "./presentation";

describe("background tools presentation", () => {
  test("pluralizes the count", () => {
    expect(formatBackgroundToolCount(1)).toBe("1 tool");
    expect(formatBackgroundToolCount(2)).toBe("2 tools");
  });

  test("labels each kind", () => {
    expect(backgroundToolKindLabel("shell")).toBe("Shell");
    expect(backgroundToolKindLabel("monitor")).toBe("Monitor");
    expect(backgroundToolKindLabel("future-kind")).toBe("Tool");
  });

  test("copies the command, or the description when there is none", () => {
    expect(
      backgroundToolCopyText({
        id: "a",
        kind: "shell",
        description: "dev",
        command: "npm run dev",
      }),
    ).toBe("npm run dev");
    expect(backgroundToolCopyText({ id: "a", kind: "shell", description: "dev" })).toBe("dev");
    expect(
      backgroundToolCopyText({ id: "a", kind: "shell", description: "dev", command: "  " }),
    ).toBe("dev");
  });

  test("detects tools", () => {
    expect(hasBackgroundTools(undefined)).toBe(false);
    expect(hasBackgroundTools([])).toBe(false);
    expect(hasBackgroundTools([{ id: "a", kind: "shell", description: "x" }])).toBe(true);
  });
});
