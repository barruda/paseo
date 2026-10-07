import { describe, expect, it } from "vitest";
import type { WorkspaceTasks } from "../shared/tasks";
import { addTask, advance, clearDoneTasks, EMPTY_WORKSPACE, moveTask, updateTask } from "./model";

const NOW = "2026-10-07T00:00:00.000Z";

function withTasks(...texts: string[]): WorkspaceTasks {
  return texts.reduce(
    (state, text, index) => addTask(state, { id: `t${index + 1}`, text }, NOW),
    EMPTY_WORKSPACE,
  );
}

const summary = (state: WorkspaceTasks) =>
  state.tasks.map((task) => `${task.id}:${task.status}:${task.agentId ?? "-"}`);

describe("addTask", () => {
  it("appends a trimmed pending task and ignores blank text", () => {
    const state = addTask(withTasks("a"), { id: "t2", text: "  b  " }, NOW);
    expect(state.tasks.map((task) => task.text)).toEqual(["a", "b"]);
    expect(addTask(state, { id: "t3", text: "   " }, NOW)).toBe(state);
  });
});

describe("advance", () => {
  it("finishes the agent's active task and activates the first pending one", () => {
    let state = withTasks("a", "b", "c");
    let outcome = advance(state, "agent-1", NOW);
    expect(outcome.task?.id).toBe("t1");
    expect(outcome.remaining).toBe(2);
    state = outcome.state;

    outcome = advance(state, "agent-1", NOW);
    expect(outcome.task?.id).toBe("t2");
    expect(summary(outcome.state)).toEqual([
      "t1:done:agent-1",
      "t2:active:agent-1",
      "t3:pending:-",
    ]);
  });

  it("leaves other agents' active tasks alone", () => {
    const first = advance(withTasks("a", "b"), "agent-1", NOW).state;
    const second = advance(first, "agent-2", NOW);
    expect(summary(second.state)).toEqual(["t1:active:agent-1", "t2:active:agent-2"]);
  });

  it("marks the last task done and returns no task when the backlog is empty", () => {
    const first = advance(withTasks("a"), "agent-1", NOW).state;
    const outcome = advance(first, "agent-1", NOW);
    expect(outcome.task).toBeNull();
    expect(summary(outcome.state)).toEqual(["t1:done:agent-1"]);
  });
});

describe("updateTask", () => {
  it("returns a task to the backlog unassigned", () => {
    const active = advance(withTasks("a"), "agent-1", NOW).state;
    expect(summary(updateTask(active, "t1", { status: "pending" }, NOW))).toEqual(["t1:pending:-"]);
  });
});

describe("moveTask", () => {
  it("moves within bounds", () => {
    const state = withTasks("a", "b", "c");
    expect(moveTask(state, "t3", -1).tasks.map((task) => task.id)).toEqual(["t1", "t3", "t2"]);
    expect(moveTask(state, "t1", -1)).toBe(state);
  });
});

describe("clearDoneTasks", () => {
  it("drops finished tasks only", () => {
    const state = updateTask(withTasks("a", "b"), "t1", { status: "done" }, NOW);
    expect(clearDoneTasks(state).tasks.map((task) => task.id)).toEqual(["t2"]);
  });
});
