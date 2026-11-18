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
  expect(section).toContain("Never edit or patch files inside `node_modules` in place");
});
