import { describe, expect, it } from "vitest";
import {
  captureDoc,
  findBrowsersDesk,
  isDocPath,
  joinPath,
  parentPathOf,
  sortDocs,
  sortTreeEntries,
  type DocEntry,
  type StatFile,
} from "./model";

let counter = 0;
const input = (path: string, overrides: Partial<Parameters<typeof captureDoc>[1]> = {}) => ({
  serverId: "srv",
  projectRef: "srv:p1",
  workspaceId: "ws1",
  path,
  newId: () => `id${++counter}`,
  ...overrides,
});

function files(map: Record<string, number>): StatFile {
  return async (path) => (path in map ? { modifiedAt: map[path], size: 1 } : null);
}

const entry = (path: string, modifiedAt = 1, overrides: Partial<DocEntry> = {}): DocEntry => ({
  id: `e-${path}`,
  serverId: "srv",
  projectRef: "srv:p1",
  workspaceId: "ws1",
  name: path.split("/").pop() ?? path,
  path,
  modifiedAt,
  ...overrides,
});

describe("isDocPath", () => {
  it("accepts reports and notes only", () => {
    expect(isDocPath("/a/report.html")).toBe(true);
    expect(isDocPath("/a/NOTES.MD")).toBe(true);
    expect(isDocPath("/a/x.markdown")).toBe(true);
    expect(isDocPath("/a/x.ts")).toBe(false);
    expect(isDocPath("/a/.md")).toBe(false);
  });
});

describe("paths", () => {
  it("joins and takes parents", () => {
    expect(joinPath("/repo/", "docs/a.md")).toBe("/repo/docs/a.md");
    expect(joinPath("/repo", "./a.md")).toBe("/repo/a.md");
    expect(joinPath("/repo", "/etc/a.md")).toBe("/etc/a.md");
    expect(parentPathOf("/repo/docs/a.md")).toBe("/repo/docs");
    expect(parentPathOf("/a.md")).toBe("/");
  });
});

describe("captureDoc", () => {
  it("adds a mentioned file that exists", async () => {
    const next = await captureDoc([], input("/r/a.md"), files({ "/r/a.md": 5 }));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ path: "/r/a.md", name: "a.md", modifiedAt: 5 });
  });

  it("ignores a path that is not a file on the host or not a document", async () => {
    const entries: DocEntry[] = [];
    expect(await captureDoc(entries, input("/r/a.md"), files({}))).toBe(entries);
    expect(await captureDoc(entries, input("/r/a.ts"), files({ "/r/a.ts": 1 }))).toBe(entries);
  });

  it("keeps the list as is when the same file is mentioned again", async () => {
    const entries = [entry("/r/a.md", 5)];
    expect(await captureDoc(entries, input("/r/a.md"), files({ "/r/a.md": 5 }))).toBe(entries);
  });

  it("refreshes the time of the same file", async () => {
    const entries = [entry("/r/a.md", 5)];
    const next = await captureDoc(entries, input("/r/a.md"), files({ "/r/a.md": 9 }));
    expect(next[0].modifiedAt).toBe(9);
    expect(next).toHaveLength(1);
  });

  it("follows a document that moved", async () => {
    const entries = [entry("/r/a.md", 5)];
    const next = await captureDoc(
      entries,
      input("/r/docs/a.md", { workspaceId: "ws2" }),
      files({ "/r/docs/a.md": 6 }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "e-/r/a.md",
      path: "/r/docs/a.md",
      workspaceId: "ws2",
      modifiedAt: 6,
    });
  });

  it("lists two files that share a name while both exist", async () => {
    const entries = [entry("/r/a.md", 5)];
    const next = await captureDoc(
      entries,
      input("/r/docs/a.md"),
      files({ "/r/a.md": 5, "/r/docs/a.md": 6 }),
    );
    expect(next.map((e) => e.path)).toEqual(["/r/a.md", "/r/docs/a.md"]);
  });

  it("keeps projects apart", async () => {
    const entries = [entry("/r/a.md", 5)];
    const next = await captureDoc(
      entries,
      input("/q/a.md", { projectRef: "srv:p2" }),
      files({ "/q/a.md": 6 }),
    );
    expect(next).toHaveLength(2);
  });
});

describe("sorting", () => {
  const docs = [
    { name: "b.md", modifiedAt: 1 },
    { name: "a.md", modifiedAt: 2 },
    { name: "c10.md", modifiedAt: 3 },
    { name: "c2.md", modifiedAt: 3 },
  ];

  it("puts the newest first, then by name", () => {
    expect(sortDocs(docs, "recent").map((d) => d.name)).toEqual([
      "c2.md",
      "c10.md",
      "a.md",
      "b.md",
    ]);
  });

  it("sorts A to Z with numbers in order", () => {
    expect(sortDocs(docs, "name").map((d) => d.name)).toEqual(["a.md", "b.md", "c2.md", "c10.md"]);
  });

  it("keeps folders before files whatever the sort", () => {
    const entries = [
      { name: "z-dir", kind: "directory" as const, modifiedAt: 1 },
      { name: "a.md", kind: "file" as const, modifiedAt: 9 },
      { name: "a-dir", kind: "directory" as const, modifiedAt: 0 },
    ];
    expect(sortTreeEntries(entries, "recent").map((e) => e.name)).toEqual([
      "z-dir",
      "a-dir",
      "a.md",
    ]);
    expect(sortTreeEntries(entries, "name").map((e) => e.name)).toEqual(["a-dir", "z-dir", "a.md"]);
  });
});

describe("findBrowsersDesk", () => {
  it("finds the Navegadores Desk whatever the case or accents", () => {
    const desks = [
      { id: "a", name: "Primary tasks" },
      { id: "b", name: " NAVEGADORES " },
    ];
    expect(findBrowsersDesk(desks)).toBe("b");
    expect(findBrowsersDesk([{ id: "c", name: "Navegador" }])).toBe("c");
  });

  it("is null when there is no such Desk", () => {
    expect(findBrowsersDesk([{ id: "a", name: "Primary tasks" }])).toBeNull();
  });
});
