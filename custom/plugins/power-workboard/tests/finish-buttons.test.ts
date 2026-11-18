import { expect, it } from "vitest";
import { finishButtons } from "../client/board-utils";
import { finishSchema } from "../shared/model";

it("a Done card with nothing finished offers Commit, PR description and Merge, Merge highlighted", () => {
  expect(finishButtons(undefined)).toEqual({
    steps: ["commit", "pr", "merge"],
    primary: "merge",
  });
  expect(finishButtons(finishSchema.parse({}))).toEqual({
    steps: ["commit", "pr", "merge"],
    primary: "merge",
  });
});

it("a committed card that is not merged keeps every button", () => {
  const finish = finishSchema.parse({ committedAt: "2026-11-17T23:50:00Z" });
  expect(finishButtons(finish)).toEqual({
    steps: ["commit", "pr", "merge"],
    primary: "merge",
  });
});

it("a merged card drops Commit and Merge and keeps PR description, not highlighted", () => {
  const merged = finishSchema.parse({
    committedAt: "2026-11-17T23:54:30Z",
    mergedAt: "2026-11-17T23:54:38Z",
  });
  expect(finishButtons(merged)).toEqual({ steps: ["pr"], primary: null });
  // Asking for a PR description after the merge, or its error, does not bring Merge back.
  const asking = finishSchema.parse({
    ...merged,
    running: "pr",
    error: "No agent of this task can write the description",
  });
  expect(finishButtons(asking)).toEqual({ steps: ["pr"], primary: null });
});
