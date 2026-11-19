import { expect, it } from "vitest";
import { parseReport } from "../server/assistant/report";
import { assistantSection } from "../server/orchestrator";

const ok = { status: "done", summary: "Added X", filesChanged: ["a.ts"] };

it("reads a valid report and fills the defaults", () => {
  const { report, text } = parseReport(
    `All good.\n<report>${JSON.stringify(ok)}</report>`,
  );
  expect(report).toEqual({
    status: "done",
    summary: "Added X",
    filesChanged: ["a.ts"],
    checks: [],
    risks: [],
    question: null,
    progress: null,
    resumeAfter: null,
    waitingFor: null,
    // CUSTOM(assistant-cards)
    options: [],
    recommend: null,
    why: null,
    outcomes: [],
    notDone: [],
  });
  expect(text).toBe("All good.");
});

it("returns no report for invalid JSON or a schema mismatch, and still strips the block", () => {
  expect(parseReport("Hi <report>{nope</report>")).toEqual({
    report: null,
    text: "Hi",
  });
  const wrong = parseReport(
    `Hi <report>${JSON.stringify({ status: "great", summary: "x" })}</report>`,
  );
  expect(wrong).toEqual({ report: null, text: "Hi" });
});

it("returns no report and the whole reply when there is no block", () => {
  expect(parseReport("  Just text  ")).toEqual({
    report: null,
    text: "Just text",
  });
});

it("the last block wins", () => {
  const first = JSON.stringify({ ...ok, summary: "first" });
  const last = JSON.stringify({
    status: "blocked",
    summary: "last",
    question: "Which?",
  });
  const { report, text } = parseReport(
    `Example: <report>${first}</report>\nReal work.\n<report>\n${last}\n</report>\n`,
  );
  expect(report).toMatchObject({
    status: "blocked",
    summary: "last",
    question: "Which?",
  });
  expect(text).toContain("Example:");
  expect(text).toContain("Real work.");
  expect(text).not.toContain("blocked");
});

it("an invalid last block does not fall back to an earlier valid one", () => {
  const { report } = parseReport(
    `<report>${JSON.stringify(ok)}</report> <report>oops</report>`,
  );
  expect(report).toBeNull();
});

it("tells the task's agent to keep its installed dependencies for the review", () => {
  const section = assistantSection();
  expect(section).toContain("never delete `node_modules`");
  expect(section).toContain("Do not symlink another checkout's `node_modules`");
  expect(section).toContain(
    "Never edit or patch files inside `node_modules` in place",
  );
});

// CUSTOM(task-checkpoints)
it("tells the task's agent how to end a session with a checkpoint", () => {
  const section = assistantSection();
  expect(section).toContain('"checkpoint"');
  expect(section).toContain('"progress": {"done": string[], "next": string[]}');
  expect(section).toContain('"resumeAfter"');
  const body = JSON.stringify({
    status: "checkpoint",
    summary: "Half",
    progress: { done: ["A"], next: ["B"] },
    resumeAfter: "2026-09-23T09:00:00Z",
    waitingFor: "CI",
  });
  const { report } = parseReport(`<report>${body}</report>`);
  expect(report).toMatchObject({
    status: "checkpoint",
    progress: { done: ["A"], next: ["B"] },
    resumeAfter: "2026-09-23T09:00:00Z",
    waitingFor: "CI",
  });
});

// CUSTOM(assistant-cards)
it("tells the task's agent about the review map and the question's options", () => {
  const section = assistantSection();
  for (const field of [
    '"outcomes"',
    '"notDone"',
    '"options"',
    '"recommend"',
    '"why"',
  ])
    expect(section).toContain(field);
  expect(section).toContain('"seen" | "tested" | "unverified"');
  expect(section).toContain('"skipped" | "unverified" | "outside"');
});
