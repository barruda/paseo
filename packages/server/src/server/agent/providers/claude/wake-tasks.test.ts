// CUSTOM(monitor-quiet-finish)
import { describe, expect, test } from "vitest";
import {
  countClaudeWakeTasks,
  mapClaudeBackgroundTools,
  readClaudeToolCommand,
} from "./wake-tasks.js";

describe("countClaudeWakeTasks", () => {
  test("counts monitors, background subagents and workflows", () => {
    expect(
      countClaudeWakeTasks({
        subtype: "background_tasks_changed",
        tasks: [
          { task_id: "a", task_type: "local_bash", shell_kind: "monitor" },
          { task_id: "b", task_type: "monitor_mcp" },
          { task_id: "c", task_type: "monitor_ws" },
          { task_id: "d", task_type: "local_agent" },
          { task_id: "e", task_type: "local_workflow" },
        ],
      }),
    ).toBe(5);
  });

  test("leaves out plain background shells and ambient monitors", () => {
    expect(
      countClaudeWakeTasks({
        subtype: "background_tasks_changed",
        tasks: [
          { task_id: "a", task_type: "local_bash" },
          { task_id: "b", task_type: "local_bash", shell_kind: "bash" },
          { task_id: "c", task_type: "monitor_ws", ambient: true },
        ],
      }),
    ).toBe(0);
  });

  test("an empty or malformed payload counts nothing", () => {
    expect(countClaudeWakeTasks({ subtype: "background_tasks_changed", tasks: [] })).toBe(0);
    expect(countClaudeWakeTasks({ subtype: "background_tasks_changed" })).toBe(0);
  });
});

// CUSTOM(background-tools)
describe("mapClaudeBackgroundTools", () => {
  test("maps shells and monitors, attaches commands, skips subagents and ambient tasks", () => {
    const commands = new Map([["b", "npm run dev"]]);
    expect(
      mapClaudeBackgroundTools(
        {
          subtype: "background_tasks_changed",
          tasks: [
            { task_id: "a", task_type: "local_bash", shell_kind: "monitor", description: "tail" },
            { task_id: "b", task_type: "local_bash", description: "dev server" },
            { task_id: "c", task_type: "monitor_mcp", description: "ci" },
            { task_id: "d", task_type: "local_agent", description: "research" },
            { task_id: "e", task_type: "local_workflow", description: "flow" },
            { task_id: "f", task_type: "local_bash", ambient: true, description: "housekeeping" },
            { task_id: "g", task_type: "something_new", description: "new" },
          ],
        },
        commands,
      ),
    ).toEqual([
      { id: "a", kind: "monitor", description: "tail" },
      { id: "b", kind: "shell", description: "dev server", command: "npm run dev" },
      { id: "c", kind: "monitor", description: "ci" },
      { id: "g", kind: "other", description: "new" },
    ]);
  });

  test("an empty or malformed message gives an empty list", () => {
    expect(mapClaudeBackgroundTools({ tasks: [] }, new Map())).toEqual([]);
    expect(mapClaudeBackgroundTools(null, new Map())).toEqual([]);
  });

  test("reads the command from a tool input", () => {
    expect(readClaudeToolCommand({ command: "sleep 9" })).toBe("sleep 9");
    expect(readClaudeToolCommand({ command: " " })).toBeUndefined();
    expect(readClaudeToolCommand(null)).toBeUndefined();
  });
});
