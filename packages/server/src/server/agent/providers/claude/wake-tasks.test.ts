// CUSTOM(monitor-quiet-finish)
import { describe, expect, test } from "vitest";
import { countClaudeWakeTasks } from "./wake-tasks.js";

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
