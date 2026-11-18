// CUSTOM(assistant-reports)
import { expect, it } from "vitest";
import {
  descriptionExcerpt,
  filterReportTasks,
  formatClock,
  kindIcon,
  kindTone,
  reportProjects,
} from "../client/assistant/reports-format";
import { relativeTime } from "../client/assistant/conversations-format";
import { reportsStrings } from "../client/assistant/reports-strings";
import type { ReportTask } from "../shared/assistant-reports";

const task = (
  taskId: string,
  title: string,
  projectId: string | null,
  projectName: string,
): ReportTask => ({
  taskId,
  title,
  projectId,
  projectName,
  column: null,
  lastAt: "2026-01-01T00:00:00Z",
  lastSummary: "",
  items: 1,
  assistantItems: 1,
});
const tasks = [
  task("1", "Fix login", "p2", "Zeta"),
  task("2", "Add search", "p1", "alpha"),
  task("3", "Tidy", null, "Loose"),
];

it("filters by title and project name, case-insensitively", () => {
  expect(filterReportTasks(tasks, "", null)).toHaveLength(3);
  expect(filterReportTasks(tasks, "LOGIN", null).map((t) => t.taskId)).toEqual([
    "1",
  ]);
  expect(filterReportTasks(tasks, "alp", null).map((t) => t.taskId)).toEqual([
    "2",
  ]);
  expect(filterReportTasks(tasks, "", "p1").map((t) => t.taskId)).toEqual([
    "2",
  ]);
  expect(filterReportTasks(tasks, "", "Loose").map((t) => t.taskId)).toEqual([
    "3",
  ]);
  expect(filterReportTasks(tasks, "login", "p1")).toEqual([]);
});

it("lists distinct projects sorted by name, using the name when there is no id", () => {
  expect(reportProjects([...tasks, task("4", "x", "p1", "alpha")])).toEqual([
    { id: "p1", name: "alpha" },
    { id: "Loose", name: "Loose" },
    { id: "p2", name: "Zeta" },
  ]);
});

it("cuts the description to its first paragraph and the limit", () => {
  expect(descriptionExcerpt("short")).toEqual({
    excerpt: "short",
    truncated: false,
  });
  expect(descriptionExcerpt("one\n\ntwo")).toEqual({
    excerpt: "one",
    truncated: true,
  });
  const long = descriptionExcerpt("a".repeat(300), 10);
  expect(long).toEqual({ excerpt: `${"a".repeat(10)}…`, truncated: true });
  expect(descriptionExcerpt("")).toEqual({ excerpt: "", truncated: false });
});

it("picks icons and tones per kind", () => {
  expect(kindIcon({ source: "assistant", kind: "merged" })).toBe("GitMerge");
  expect(kindIcon({ source: "auto", kind: "verify-failed" })).toBe("XCircle");
  expect(kindTone({ source: "auto", kind: "merged" })).toBe("success");
  expect(kindTone({ source: "auto", kind: "verify-passed" })).toBe("success");
  expect(kindTone({ source: "auto", kind: "needs-you" })).toBe("warning");
  expect(kindTone({ source: "auto", kind: "waiting-clean" })).toBe("warning");
  expect(kindTone({ source: "auto", kind: "failed" })).toBe("danger");
  expect(kindTone({ source: "auto", kind: "committed" })).toBe("muted");
  expect(kindTone({ source: "assistant", kind: "note" })).toBe("accent");
  expect(kindTone({ source: "assistant", kind: "escalated" })).toBe("warning");
});

it("formats the clock for today and other days in local time", () => {
  const now = new Date(2026, 4, 10, 15, 0).getTime();
  expect(formatClock(new Date(2026, 4, 10, 9, 5).toISOString(), now)).toBe(
    "09:05",
  );
  expect(formatClock(new Date(2026, 4, 3, 18, 30).toISOString(), now)).toBe(
    "03/05 18:30",
  );
  expect(formatClock("nope", now)).toBe("");
});

it("reuses relativeTime with the reports strings", () => {
  const now = Date.parse("2026-01-01T02:00:00Z");
  expect(relativeTime("2026-01-01T00:00:00Z", now, reportsStrings("pt"))).toBe(
    "2 h atrás",
  );
  expect(relativeTime("2026-01-01T00:00:00Z", now, reportsStrings("zh"))).toBe(
    "2h ago",
  );
});
