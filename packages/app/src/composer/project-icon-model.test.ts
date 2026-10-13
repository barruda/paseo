import { describe, expect, it } from "vitest";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { resolveComposerProjectIdentity } from "./project-icon-model";

const project: WorkspaceStructureProject = {
  viewKey: "shared-project",
  projectKey: "shared-project",
  projectName: "team/My Project",
  projectKind: "git",
  iconWorkingDir: "/projects/main",
  workspaceKeys: ["host:worktree"],
  hosts: [
    {
      serverId: "other",
      projectId: "same-id",
      iconWorkingDir: "/other/main",
      worktreeSupport: "supported",
    },
    {
      serverId: "host",
      projectId: "same-id",
      iconWorkingDir: "/projects/main",
      worktreeSupport: "supported",
      customIconRevision: "uploaded-2",
      iconRevision: "discovered-1",
    },
  ],
};

describe("composer project identity", () => {
  it("uses the workspace's parent project and the correct host's icon revisions", () => {
    expect(
      resolveComposerProjectIdentity({
        serverId: "host",
        projectId: "same-id",
        projects: [project],
      }),
    ).toEqual({
      name: "team/My Project",
      initial: "M",
      target: {
        projectViewKey: "shared-project",
        serverId: "host",
        projectId: "same-id",
        iconWorkingDir: "/projects/main",
        customIconRevision: "uploaded-2",
        iconRevision: "discovered-1",
      },
    });
  });
  it("does not display a different project when the workspace or host has no match", () => {
    expect(
      resolveComposerProjectIdentity({
        serverId: "missing",
        projectId: "same-id",
        projects: [project],
      }),
    ).toBeNull();
    expect(
      resolveComposerProjectIdentity({ serverId: "host", projectId: null, projects: [project] }),
    ).toBeNull();
    expect(
      resolveComposerProjectIdentity({
        serverId: "host",
        projectId: "different",
        projects: [project],
      }),
    ).toBeNull();
  });
  it("keeps the sidebar identity when switching projects and supplies a fallback initial", () => {
    const second = {
      ...project,
      viewKey: "second",
      projectName: "Another",
      hosts: [{ ...project.hosts[1], projectId: "second-id" }],
    };
    const identity = resolveComposerProjectIdentity({
      serverId: "host",
      projectId: "second-id",
      projects: [project, second],
    });
    expect(identity?.name).toBe("Another");
    expect(identity?.initial).toBe("A");
    expect(identity?.target.projectViewKey).toBe("second");
  });
});
