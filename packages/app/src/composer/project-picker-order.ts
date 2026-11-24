// CUSTOM(composer-project-order): the composer's project picker lists projects by name, ignoring
// case and leading dots (`.paseo-voice` sorts as `paseo-voice`), with the project path breaking
// ties between projects of the same name. Stars do not change the order.
import {
  filterWorkspaceProjectsForHost,
  getHostProjectSourceDirectory,
  type HostProjectListItem,
} from "@/projects/host-project-model";

export interface ProjectPickerSortEntry {
  name: string;
  path: string;
}

function sortName(name: string): string {
  return name.trim().replace(/^\.+/, "");
}

export function compareProjectPickerEntries(
  left: ProjectPickerSortEntry,
  right: ProjectPickerSortEntry,
): number {
  return (
    sortName(left.name).localeCompare(sortName(right.name), undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.path.localeCompare(right.path)
  );
}

export function sortProjectPickerEntries<T>(
  items: readonly T[],
  entry: (item: T) => ProjectPickerSortEntry,
): T[] {
  return [...items].sort((left, right) => compareProjectPickerEntries(entry(left), entry(right)));
}

/** Host projects in picker order; the path is the project's directory on `serverId`. */
export function sortHostProjectsForPicker(
  projects: readonly HostProjectListItem[],
  serverId: string,
): HostProjectListItem[] {
  return sortProjectPickerEntries(projects, (project) => ({
    name: project.projectName,
    path: getHostProjectSourceDirectory(project, serverId) ?? project.iconWorkingDir,
  }));
}

/**
 * The projects an empty agent tab's picker offers. Every project the host can open a workspace
 * for is listed, also one added without a workspace yet (Settings > Projects > Add project):
 * picking it creates its root workspace. The current project stays listed even when the host
 * could not create a workspace for it.
 */
export function draftTabProjectChoices(input: {
  projects: readonly HostProjectListItem[];
  serverId: string;
  allowAllProjects: boolean;
  current: HostProjectListItem | null;
}): HostProjectListItem[] {
  const creatable = filterWorkspaceProjectsForHost({
    projects: input.projects,
    serverId: input.serverId,
    allowAllProjects: input.allowAllProjects,
  });
  const listed =
    input.current && !creatable.includes(input.current) ? [input.current, ...creatable] : creatable;
  return sortHostProjectsForPicker(listed, input.serverId);
}
