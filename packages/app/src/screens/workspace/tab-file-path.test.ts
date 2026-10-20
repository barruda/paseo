import { describe, expect, it } from "vitest";
import { homeFromListedPath, resolveTabFilePath } from "./tab-file-path";

const workspaceDirectory = "/home/bruno/telus/pss-emr";

describe("resolveTabFilePath", () => {
  it("expands ~ against the host home, not the workspace", () => {
    expect(
      resolveTabFilePath({
        path: "~/telus/reports/emr-ai-core/v3.html",
        workspaceDirectory,
        home: "/home/bruno",
      }),
    ).toBe("/home/bruno/telus/reports/emr-ai-core/v3.html");
  });

  it("returns null for ~ paths without a home", () => {
    expect(resolveTabFilePath({ path: "~/a.html", workspaceDirectory, home: null })).toBeNull();
  });

  it("joins relative paths to the workspace and keeps absolute ones", () => {
    expect(resolveTabFilePath({ path: "src/a.ts", workspaceDirectory, home: null })).toBe(
      "/home/bruno/telus/pss-emr/src/a.ts",
    );
    expect(resolveTabFilePath({ path: "/etc/hosts", workspaceDirectory, home: null })).toBe(
      "/etc/hosts",
    );
  });
});

describe("homeFromListedPath", () => {
  it("reads the home from the explorer's listing of ~", () => {
    expect(homeFromListedPath("/home/bruno", workspaceDirectory)).toBe("/home/bruno");
    expect(homeFromListedPath(".", "/home/bruno")).toBe("/home/bruno");
    expect(homeFromListedPath("../..", workspaceDirectory)).toBeNull();
  });
});
