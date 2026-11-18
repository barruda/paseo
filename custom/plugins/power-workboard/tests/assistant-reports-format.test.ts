// CUSTOM(assistant-reports)
import { describe, expect, it } from "vitest";
import {
  defaultHiddenColumns,
  descriptionExcerpt,
  filterReportTasks,
  formatClock,
  kindIcon,
  kindTone,
  reportProjects,
  toggleHiddenColumn,
} from "../client/assistant/reports-format";
import {
  loadReportHiddenColumns,
  loadReportHiddenColumnsFrom,
  saveReportHiddenColumns,
  saveReportHiddenColumnsTo,
} from "../client/assistant/reports-preferences";
import { relativeTime } from "../client/assistant/conversations-format";
import { reportsStrings } from "../client/assistant/reports-strings";
import type { ReportColumn, ReportTask } from "../shared/assistant-reports";

const task = (
  taskId: string,
  title: string,
  projectId: string | null,
  projectName: string,
  columnId: string | null = null,
): ReportTask => ({
  taskId,
  title,
  projectId,
  projectName,
  column: columnId,
  columnId,
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

const columns: ReportColumn[] = [
  { id: "backlog", name: "Backlog", kind: "todo", color: "cyan" },
  { id: "ready", name: "Ready to start", kind: "ready", color: "violet" },
  { id: "done", name: "Done", kind: "done", color: "green" },
];
const boardTasks = [
  task("b1", "Plan search", "p1", "alpha", "backlog"),
  task("r1", "Fix search", "p1", "alpha", "ready"),
  task("d1", "Ship search", "p2", "Zeta", "done"),
  task("d2", "Ship login", "p1", "alpha", "done"),
  task("gone", "Old search", "p1", "alpha", null),
];
const ids = (list: ReportTask[]) => list.map((t) => t.taskId);

it("hides the Backlog columns by default and shows every other status", () => {
  const hidden = defaultHiddenColumns(columns);
  expect(hidden).toEqual(["backlog"]);
  expect(ids(filterReportTasks(boardTasks, "", null, hidden))).toEqual([
    "r1",
    "d1",
    "d2",
    "gone",
  ]);
  expect(defaultHiddenColumns([])).toEqual([]);
});

it("toggles statuses: Backlog on shows it, Done off hides it", () => {
  const withBacklog = toggleHiddenColumn(
    defaultHiddenColumns(columns),
    "backlog",
  );
  expect(withBacklog).toEqual([]);
  expect(ids(filterReportTasks(boardTasks, "", null, withBacklog))).toContain(
    "b1",
  );
  const noDone = toggleHiddenColumn(withBacklog, "done");
  expect(noDone).toEqual(["done"]);
  expect(ids(filterReportTasks(boardTasks, "", null, noDone))).toEqual([
    "b1",
    "r1",
    "gone",
  ]);
});

it("combines the status filter with the project and the search", () => {
  const hidden = ["backlog"];
  expect(ids(filterReportTasks(boardTasks, "search", "p1", hidden))).toEqual([
    "r1",
    "gone",
  ]);
  expect(ids(filterReportTasks(boardTasks, "ship", null, hidden))).toEqual([
    "d1",
    "d2",
  ]);
  expect(ids(filterReportTasks(boardTasks, "plan", null, hidden))).toEqual([]);
  expect(ids(filterReportTasks(boardTasks, "ship", "p2", ["done"]))).toEqual(
    [],
  );
});

describe("status filter preference", () => {
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };

  it("is null until saved, then survives a reload per host", () => {
    const store = storage();
    expect(loadReportHiddenColumnsFrom(store, "h1")).toBeNull();
    expect(saveReportHiddenColumnsTo(store, "h1", ["done", "done"])).toBe(true);
    expect(loadReportHiddenColumnsFrom(store, "h1")).toEqual(["done"]);
    expect(saveReportHiddenColumnsTo(store, "h1", [])).toBe(true);
    expect(loadReportHiddenColumnsFrom(store, "h1")).toEqual([]);
    expect(loadReportHiddenColumnsFrom(store, "h2")).toBeNull();
  });

  it("falls back to the default on bad data or denied storage", () => {
    const store = storage();
    store.setItem("power-workboard:reports-hidden-columns:h1", "{bad");
    expect(loadReportHiddenColumnsFrom(store, "h1")).toBeNull();
    store.setItem("power-workboard:reports-hidden-columns:h1", '{"a":1}');
    expect(loadReportHiddenColumnsFrom(store, "h1")).toBeNull();
    const denied = {
      getItem(): string | null {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(loadReportHiddenColumnsFrom(denied, "h1")).toBeNull();
    expect(saveReportHiddenColumnsTo(denied, "h1", ["x"])).toBe(false);
    const previous = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage access denied");
      },
    });
    try {
      expect(loadReportHiddenColumns("h1")).toBeNull();
      expect(saveReportHiddenColumns("h1", ["x"])).toBe(false);
    } finally {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
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
