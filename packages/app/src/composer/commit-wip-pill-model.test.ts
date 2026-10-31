import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  COMMIT_WIP_COMMAND,
  findLatestShellCommandRun,
  GIT_PUSH_COMMAND,
  initialCommitWipStep,
  shellCommandOutcome,
  stepAfterRun,
} from "./commit-wip-pill-model";

function card(id: string, command: string, status: string, exitCode: number | null): StreamItem {
  return {
    kind: "plugin",
    id: `shell-command/${id}`,
    pluginId: "shell-command",
    pluginItemId: id,
    itemKind: "shell-command",
    version: 1,
    timestamp: new Date(0),
    data: { id, command, status, exitCode },
  };
}

function message(id: string): StreamItem {
  return { kind: "user_message", id, text: "hi", timestamp: new Date(0) } as StreamItem;
}

describe("findLatestShellCommandRun", () => {
  it("finds the newest card of the command, head before tail", () => {
    const tail = [card("a", COMMIT_WIP_COMMAND, "completed", 0), message("m")];
    const head = [
      card("b", COMMIT_WIP_COMMAND, "running", null),
      card("p", GIT_PUSH_COMMAND, "running", null),
    ];
    expect(findLatestShellCommandRun([head, tail], COMMIT_WIP_COMMAND)).toEqual({
      id: "b",
      status: "running",
      exitCode: null,
    });
    expect(findLatestShellCommandRun([undefined, tail], COMMIT_WIP_COMMAND)?.id).toBe("a");
  });

  it("stops looking after the last few items", () => {
    const tail = [card("old", COMMIT_WIP_COMMAND, "completed", 0)];
    for (let index = 0; index < 50; index++) tail.push(message(`m${index}`));
    expect(findLatestShellCommandRun([tail], COMMIT_WIP_COMMAND)).toBeNull();
  });
});

describe("shellCommandOutcome", () => {
  it("waits for a card newer than the one seen at press time", () => {
    expect(shellCommandOutcome(null, null)).toBe("running");
    expect(shellCommandOutcome({ id: "a", status: "completed", exitCode: 0 }, "a")).toBe("running");
    expect(shellCommandOutcome({ id: "b", status: "running", exitCode: null }, "a")).toBe(
      "running",
    );
  });

  it("succeeds only on exit code 0", () => {
    expect(shellCommandOutcome({ id: "b", status: "completed", exitCode: 0 }, "a")).toBe(
      "succeeded",
    );
    expect(shellCommandOutcome({ id: "b", status: "failed", exitCode: 1 }, null)).toBe("failed");
    expect(shellCommandOutcome({ id: "b", status: "stopped", exitCode: null }, null)).toBe(
      "failed",
    );
  });
});

describe("stepAfterRun", () => {
  it("turns a good commit into Git push and a good push back into Commit: wip", () => {
    expect(stepAfterRun("commit", "succeeded")).toBe("push");
    expect(stepAfterRun("push", "succeeded")).toBe("commit");
  });

  it("keeps the step after a failure so it can be retried", () => {
    expect(stepAfterRun("commit", "failed")).toBe("commit");
    expect(stepAfterRun("push", "failed")).toBe("push");
  });
});

describe("initialCommitWipStep", () => {
  it("opens on Git push only for a clean checkout ahead of its remote", () => {
    expect(initialCommitWipStep({ isDirty: false, aheadOfOrigin: 2 })).toBe("push");
    expect(initialCommitWipStep({ isDirty: true, aheadOfOrigin: 2 })).toBe("commit");
    expect(initialCommitWipStep({ isDirty: false, aheadOfOrigin: 0 })).toBe("commit");
    expect(initialCommitWipStep({ isDirty: null, aheadOfOrigin: null })).toBe("commit");
  });
});
