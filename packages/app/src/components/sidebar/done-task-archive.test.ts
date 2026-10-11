import { describe, expect, it } from "vitest";
import { isDoneTaskWorkspace } from "./done-task-archive";

describe("isDoneTaskWorkspace", () => {
  it("matches the Workboard done label", () => {
    expect(isDoneTaskWorkspace(["task:done"])).toBe(true);
    expect(isDoneTaskWorkspace(["bug", " Task:Done "])).toBe(true);
  });

  it("ignores other labels", () => {
    expect(isDoneTaskWorkspace(undefined)).toBe(false);
    expect(isDoneTaskWorkspace([])).toBe(false);
    expect(isDoneTaskWorkspace(["task:in-progress", "task:done-ish"])).toBe(false);
  });
});
