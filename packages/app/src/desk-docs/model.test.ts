import { describe, expect, it } from "vitest";
import {
  buildProjectDocsTree,
  captureDoc,
  defaultFolderExpanded,
  externalRootOf,
  findBrowsersDesk,
  folderKey,
  isDocPath,
  isFolderExpanded,
  joinPath,
  parentPathOf,
  projectFilterLabel,
  relativeSegments,
  sortDocs,
  sortTreeEntries,
  visibleProjects,
  workspaceHolding,
  type DocEntry,
  type DocTreeFolder,
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

describe("project filter", () => {
  const projects = [{ ref: "srv:a" }, { ref: "srv:b" }, { ref: "srv:c" }];

  it("shows every project but the hidden ones", () => {
    expect(visibleProjects(projects, []).map((p) => p.ref)).toEqual(["srv:a", "srv:b", "srv:c"]);
    expect(visibleProjects(projects, ["srv:b"]).map((p) => p.ref)).toEqual(["srv:a", "srv:c"]);
  });

  it("leaves a project it has never seen visible, so a new project starts marked", () => {
    const withNew = [...projects, { ref: "srv:new" }];
    expect(visibleProjects(withNew, ["srv:a", "srv:c"]).map((p) => p.ref)).toEqual([
      "srv:b",
      "srv:new",
    ]);
  });

  it("labels the trigger all, a count, or none", () => {
    expect(projectFilterLabel(3, 3)).toBe("All projects");
    expect(projectFilterLabel(3, 2)).toBe("2 projects");
    expect(projectFilterLabel(3, 1)).toBe("1 project");
    expect(projectFilterLabel(3, 0)).toBe("No projects");
    expect(projectFilterLabel(0, 0)).toBe("No projects");
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

describe("docs tree", () => {
  const workspace = "/repo";

  it("places documents under their folders, folders before files", () => {
    const docs = [
      entry("/repo/README.md", 1),
      entry("/repo/docs/guide/a.md", 5),
      entry("/repo/docs/guide/b.md", 4),
      entry("/repo/docs/notes.md", 3),
      entry("/repo/src/c.md", 2),
    ];
    const tree = buildProjectDocsTree(docs, [workspace], "name");
    expect(tree.project?.nodes.map((node) => node.name)).toEqual(["docs", "src", "README.md"]);
    const docsFolder = tree.project?.nodes[0] as DocTreeFolder;
    expect(docsFolder).toMatchObject({ kind: "folder", path: "/repo/docs", count: 3 });
    expect(docsFolder.children.map((node) => node.name)).toEqual(["guide", "notes.md"]);
    const guide = docsFolder.children[0] as DocTreeFolder;
    expect(guide.children.map((node) => node.name)).toEqual(["a.md", "b.md"]);
  });

  it("folds single-child folder chains into one row and stops before a file", () => {
    const docs = [entry("/repo/.claude/skills/mw-terrain-advanced-usage/SKILL.md", 1)];
    const tree = buildProjectDocsTree(docs, [workspace], "name");
    expect(tree.project?.nodes).toHaveLength(1);
    const row = tree.project!.nodes[0] as DocTreeFolder;
    expect(row).toMatchObject({
      kind: "folder",
      name: ".claude/skills/mw-terrain-advanced-usage",
      path: "/repo/.claude/skills/mw-terrain-advanced-usage",
      count: 1,
    });
    expect(row.children.map((node) => node.name)).toEqual(["SKILL.md"]);
  });

  it("keeps folders apart when they hold more than one child", () => {
    const docs = [entry("/repo/a/x.md", 1), entry("/repo/a/y.md", 2), entry("/repo/a/b/z.md", 3)];
    const tree = buildProjectDocsTree(docs, [workspace], "name");
    const a = tree.project?.nodes[0] as DocTreeFolder;
    expect(a.name).toBe("a");
    expect(a.children.map((node) => node.name)).toEqual(["b", "x.md", "y.md"]);
  });

  it("puts documents outside the workspace in one group per root", () => {
    const docs = [
      entry("/home/bruno/.claude/skills/x/SKILL.md", 3),
      entry("/home/bruno/.claude/skills/y/SKILL.md", 2),
      entry("/home/bruno/uprojects/tmp/report.md", 4),
      entry("/home/bruno/.claude/projects/p/memory/notes.md", 5),
      entry("/repo/inside.md", 1),
    ];
    const tree = buildProjectDocsTree(docs, [workspace], "name");
    expect(tree.project?.nodes.map((node) => node.name)).toEqual(["inside.md"]);
    expect(tree.external.map((group) => group.label).sort()).toEqual([
      "memory",
      "tmp",
      "~/.claude",
    ]);
    const claude = tree.external.find((group) => group.label === "~/.claude")!;
    expect(claude.root).toBe("/home/bruno/.claude");
    expect(claude.count).toBe(2);
    expect(claude.nodes.map((node) => node.name)).toEqual(["skills"]);
    const memory = tree.external.find((group) => group.label === "memory")!;
    expect(memory.root).toBe("/home/bruno/.claude/projects/p/memory");
    expect(memory.nodes.map((node) => node.name)).toEqual(["notes.md"]);
  });

  it("prefers the deepest workspace that holds a document", () => {
    const docs = [entry("/repo/pkg/a.md", 1)];
    const tree = buildProjectDocsTree(docs, ["/repo", "/repo/pkg"], "name");
    expect(tree.project?.nodes.map((node) => node.name)).toEqual(["a.md"]);
    expect(tree.external).toEqual([]);
    expect(workspaceHolding("/repo/pkg/a.md", ["/repo", "/repo/pkg"])).toBe("/repo/pkg");
    expect(relativeSegments("/repo/pkg/a.md", "/repo/pkg")).toEqual(["a.md"]);
    expect(relativeSegments("/other/a.md", "/repo")).toBeNull();
  });

  it("orders folders by their newest document in Most recent", () => {
    const docs = [
      entry("/repo/old/a.md", 1),
      entry("/repo/old/b.md", 9),
      entry("/repo/new/a.md", 5),
      entry("/repo/zzz.md", 20),
    ];
    const tree = buildProjectDocsTree(docs, [workspace], "recent");
    expect(tree.project?.nodes.map((node) => node.name)).toEqual(["old", "new", "zzz.md"]);
    const old = tree.project?.nodes[0] as DocTreeFolder;
    expect(old.children.map((node) => node.name)).toEqual(["b.md", "a.md"]);
  });

  it("orders everything by name in A to Z", () => {
    const docs = [
      entry("/repo/zeta/a.md", 1),
      entry("/repo/alpha/b.md", 9),
      entry("/repo/mmm.md", 20),
      entry("/repo/aaa.md", 30),
    ];
    const tree = buildProjectDocsTree(docs, [workspace], "name");
    expect(tree.project?.nodes.map((node) => node.name)).toEqual([
      "alpha",
      "zeta",
      "aaa.md",
      "mmm.md",
    ]);
  });

  it("sorts external groups by their newest document or by label", () => {
    const docs = [entry("/home/bruno/uprojects/aaa/a.md", 8), entry("/home/bruno/.claude/x.md", 2)];
    expect(
      buildProjectDocsTree(docs, [workspace], "recent").external.map((group) => group.label),
    ).toEqual(["aaa", "~/.claude"]);
    expect(
      buildProjectDocsTree(docs, [workspace], "name").external.map((group) => group.label),
    ).toEqual(["~/.claude", "aaa"]);
  });
});

describe("externalRootOf", () => {
  it("labels the agent memory, a dot folder, and the first two folders under home", () => {
    expect(externalRootOf("/home/bruno/.paseo/agents/a/memory/m.md")).toEqual({
      root: "/home/bruno/.paseo/agents/a/memory",
      label: "memory",
    });
    expect(externalRootOf("/home/bruno/.claude/skills/x/SKILL.md")).toEqual({
      root: "/home/bruno/.claude",
      label: "~/.claude",
    });
    expect(externalRootOf("/home/bruno/uprojects/tmp/report.md")).toEqual({
      root: "/home/bruno/uprojects/tmp",
      label: "tmp",
    });
    expect(externalRootOf("/tmp/report.md")).toEqual({ root: "/tmp", label: "tmp" });
    expect(externalRootOf("/home/bruno/notes.md")).toEqual({
      root: "/home/bruno",
      label: "~",
    });
  });
});

describe("folder state", () => {
  it("starts folders closed only above the document limit", () => {
    expect(defaultFolderExpanded(0)).toBe(true);
    expect(defaultFolderExpanded(15)).toBe(true);
    expect(defaultFolderExpanded(16)).toBe(false);
  });

  it("follows an explicit override and scopes keys by project", () => {
    const key = folderKey("srv:p1", "/repo/docs");
    expect(key).toBe("srv:p1|/repo/docs");
    expect(isFolderExpanded({}, key, false)).toBe(false);
    expect(isFolderExpanded({ [key]: true }, key, false)).toBe(true);
    expect(isFolderExpanded({ [key]: false }, key, true)).toBe(false);
  });
});
