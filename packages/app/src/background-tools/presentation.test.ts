// CUSTOM(background-tools)
import { describe, expect, test } from "vitest";
import {
  backgroundToolCopyText,
  backgroundToolKindLabel,
  buildBackgroundToolsSegments,
  hasBackgroundTools,
  hasWakingBackgroundTools,
} from "./presentation";

describe("background tools presentation", () => {
  test("splits the chip into running monitors and plain shells", () => {
    const shell = { id: "s", kind: "shell", description: "dev" };
    const monitor = { id: "m", kind: "monitor", description: "watch" };
    expect(buildBackgroundToolsSegments([shell])).toEqual([{ bucket: null, text: "1 shell" }]);
    expect(buildBackgroundToolsSegments([monitor, { ...monitor, id: "m2" }])).toEqual([
      { bucket: "running", text: "2 monitors" },
    ]);
    expect(
      buildBackgroundToolsSegments([
        shell,
        monitor,
        { ...shell, id: "s2" },
        { ...shell, kind: "other" },
      ]),
    ).toEqual([
      { bucket: "running", text: "1 monitor" },
      { bucket: null, text: "3 shells" },
    ]);
    expect(buildBackgroundToolsSegments([])).toEqual([]);
  });

  test("only monitors count as waking work", () => {
    expect(hasWakingBackgroundTools(undefined)).toBe(false);
    expect(hasWakingBackgroundTools([{ id: "a", kind: "shell", description: "x" }])).toBe(false);
    expect(
      hasWakingBackgroundTools([
        { id: "a", kind: "shell", description: "x" },
        { id: "b", kind: "monitor", description: "y" },
      ]),
    ).toBe(true);
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
