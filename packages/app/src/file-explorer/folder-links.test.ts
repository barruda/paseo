import { describe, expect, it } from "vitest";
import {
  absoluteInlinePath,
  explorerAncestorPaths,
  filesystemRootOf,
  mayBeFolderPath,
  resolveFolderLinkTarget,
  useFolderLinkStore,
} from "./folder-links";

describe("resolveFolderLinkTarget", () => {
  it("reveals folders inside the workspace by relative path", () => {
    expect(
      resolveFolderLinkTarget({ workspaceRoot: "/repo/", absolutePath: "/repo/packages/app/" }),
    ).toEqual({ kind: "workspace", relativePath: "packages/app" });
    expect(resolveFolderLinkTarget({ workspaceRoot: "/repo", absolutePath: "/repo" })).toEqual({
      kind: "workspace",
      relativePath: ".",
    });
  });

  it("roots the explorer at folders outside the workspace", () => {
    expect(
      resolveFolderLinkTarget({ workspaceRoot: "/repo", absolutePath: "/repository-other/" }),
    ).toEqual({ kind: "external", root: "/repository-other" });
    expect(
      resolveFolderLinkTarget({ workspaceRoot: "/repo", absolutePath: "/home/bruno" }),
    ).toEqual({ kind: "external", root: "/home/bruno" });
  });
});

describe("explorerAncestorPaths", () => {
  it("lists each folder to expand, outermost first", () => {
    expect(explorerAncestorPaths("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
    expect(explorerAncestorPaths(".")).toEqual([]);
  });
});

describe("absoluteInlinePath", () => {
  it("keeps absolute paths and resolves relative ones against the cwd", () => {
    expect(absoluteInlinePath("/home/bruno/telus/", "/repo")).toBe("/home/bruno/telus");
    expect(absoluteInlinePath("packages/app", "/repo/")).toBe("/repo/packages/app");
    expect(absoluteInlinePath(".", "/repo")).toBe("/repo");
    expect(absoluteInlinePath("packages", undefined)).toBeNull();
  });
});

describe("mayBeFolderPath", () => {
  it("treats extensionless names as possible folders", () => {
    expect(mayBeFolderPath("/home/bruno/telus")).toBe(true);
    expect(mayBeFolderPath("Makefile")).toBe(true);
    expect(mayBeFolderPath("/home/bruno/.bashrc")).toBe(false);
    expect(mayBeFolderPath("src/index.ts")).toBe(false);
  });
});

describe("useFolderLinkStore", () => {
  it("drops a request only when the nonce matches the latest one", () => {
    const store = useFolderLinkStore.getState();
    store.requestFolder("workspace:w1", "/a");
    const first = useFolderLinkStore.getState().requests["workspace:w1"];
    store.requestFolder("workspace:w1", "/b");
    store.takeRequest("workspace:w1", first.nonce);
    expect(useFolderLinkStore.getState().requests["workspace:w1"]?.path).toBe("/b");
    const second = useFolderLinkStore.getState().requests["workspace:w1"];
    store.takeRequest("workspace:w1", second.nonce);
    expect(useFolderLinkStore.getState().requests["workspace:w1"]).toBeUndefined();
  });
});

describe("filesystemRootOf", () => {
  it("returns the root that contains the path", () => {
    expect(filesystemRootOf("/home/bruno/telus")).toBe("/");
    expect(filesystemRootOf("C:\\Users\\bruno")).toBe("C:/");
  });
});
