import { expect, it } from "vitest";
import { finishButtons, finishInlineLayout } from "../client/board-utils";
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

it("a folder-mode Done card never offers Merge", () => {
  expect(finishButtons(undefined, true)).toEqual({
    steps: ["commit", "pr"],
    primary: "commit",
  });
  const committed = finishSchema.parse({
    committedAt: "2026-11-20T12:00:00Z",
  });
  expect(finishButtons(committed, true)).toEqual({
    steps: ["pr"],
    primary: null,
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

it("a merged card with no PR body puts the status and PR description on one line", () => {
  expect(finishInlineLayout({ hasStatus: true, hasPr: false, steps: 1 })).toBe(
    true,
  );
});

it("keeps the rows stacked when there is a PR body or more than one button", () => {
  expect(finishInlineLayout({ hasStatus: true, hasPr: true, steps: 1 })).toBe(
    false,
  );
  expect(finishInlineLayout({ hasStatus: true, hasPr: false, steps: 3 })).toBe(
    false,
  );
  expect(finishInlineLayout({ hasStatus: false, hasPr: false, steps: 1 })).toBe(
    false,
  );
});
