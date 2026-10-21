import { describe, expect, it } from "vitest";
import { listNewAgentProjects } from "./model";

function workspace(
  id: string,
  projectId: string,
  overrides: Partial<{
    projectDisplayName: string;
    projectCustomName: string | null;
    workspaceDirectory: string;
    archivingAt: string | null;
  }> = {},
) {
  return {
    id,
    projectId,
    projectDisplayName: projectId,
    projectCustomName: null,
    projectRootPath: `/src/${projectId}`,
    workspaceDirectory: `/src/${projectId}`,
    archivingAt: null,
    ...overrides,
  };
}

describe("listNewAgentProjects", () => {
  it("lists one row per project, sorted by name", () => {
    expect(
      listNewAgentProjects([
        workspace("w1", "zeta"),
        workspace("w2", "alpha"),
        workspace("w3", "alpha", { workspaceDirectory: "/wt/alpha-1" }),
      ]),
    ).toEqual([
      { projectId: "alpha", label: "alpha", workspaceId: "w2" },
      { projectId: "zeta", label: "zeta", workspaceId: "w1" },
    ]);
  });

  it("prefers the main checkout over a worktree seen first", () => {
    const projects = listNewAgentProjects([
      workspace("wt", "app", { workspaceDirectory: "/wt/app-1" }),
      workspace("main", "app"),
    ]);
    expect(projects.map((project) => project.workspaceId)).toEqual(["main"]);
  });

  it("falls back to a worktree when the project has no main checkout", () => {
    const projects = listNewAgentProjects([
      workspace("wt", "app", { workspaceDirectory: "/wt/app-1" }),
    ]);
    expect(projects.map((project) => project.workspaceId)).toEqual(["wt"]);
  });

  it("uses the custom project name and skips archiving workspaces", () => {
    expect(
      listNewAgentProjects([
        workspace("w1", "app", { projectCustomName: "My App" }),
        workspace("w2", "gone", { archivingAt: "2026-10-21T00:00:00Z" }),
      ]),
    ).toEqual([{ projectId: "app", label: "My App", workspaceId: "w1" }]);
  });

  it("handles a host with no workspaces", () => {
    expect(listNewAgentProjects(null)).toEqual([]);
  });
});
