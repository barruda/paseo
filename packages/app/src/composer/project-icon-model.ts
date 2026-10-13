// CUSTOM(composer-project-icon): resolve identity by project placement, never the worktree cwd.
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";

interface ComposerProjectIdentity {
  name: string;
  initial: string;
  target: ProjectIconTarget;
}

export function resolveComposerProjectIdentity(input: {
  serverId: string;
  projectId: string | null;
  projects: readonly WorkspaceStructureProject[];
}): ComposerProjectIdentity | null {
  for (const project of input.projects) {
    const placement = project.hosts.find(
      (host) => host.serverId === input.serverId && host.projectId === input.projectId,
    );
    if (!placement) continue;
    const target = createProjectIconTarget({ projectViewKey: project.viewKey, placement });
    if (!target) return null;
    const label = projectIconPlaceholderLabelFromDisplayName(project.projectName);
    return { name: project.projectName, initial: label.charAt(0).toUpperCase() || "?", target };
  }
  return null;
}
