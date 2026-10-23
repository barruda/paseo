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
    gitRuntime: { currentBranch: string | null } | null;
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
      {
        projectId: "alpha",
        label: "alpha",
        workspaceId: "w2",
        rootPath: "/src/alpha",
        branch: null,
      },
      { projectId: "zeta", label: "zeta", workspaceId: "w1", rootPath: "/src/zeta", branch: null },
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
    ).toEqual([
      { projectId: "app", label: "My App", workspaceId: "w1", rootPath: "/src/app", branch: null },
    ]);
  });

  it("lists a project with no workspace, such as a worktree added as a project", () => {
    expect(
      listNewAgentProjects(
        [workspace("w1", "app")],
        [
          {
            projectId: "app",
            projectDisplayName: "app",
            projectCustomName: null,
            projectRootPath: "/src/app",
          },
          {
            projectId: "app-wt",
            projectDisplayName: "app-surface",
            projectCustomName: null,
            projectRootPath: "/src/app-surface",
          },
        ],
      ),
    ).toEqual([
      { projectId: "app", label: "app", workspaceId: "w1", rootPath: "/src/app", branch: null },
      {
        projectId: "app-wt",
        label: "app-surface",
        workspaceId: null,
        rootPath: "/src/app-surface",
        branch: null,
      },
    ]);
  });

  it("carries the workspace's current branch", () => {
    const [project] = listNewAgentProjects([
      workspace("w1", "app", { gitRuntime: { currentBranch: " feature/x " } }),
    ]);
    expect(project?.branch).toBe("feature/x");
  });

  it("handles a host with no workspaces", () => {
    expect(listNewAgentProjects(null)).toEqual([]);
  });
});
