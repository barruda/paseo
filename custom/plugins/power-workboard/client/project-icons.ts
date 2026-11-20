// CUSTOM(project-icon-colors): the board draws the same image the app shows for a project.
// The snapshot only carries each project's icon revision; this query fetches the images apart,
// and a new revision in the next poll makes it refetch without reloading the plugin.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import type { Board, ProjectIconData } from "../shared/model";
import { projectIconsRpc } from "../shared/rpc";

export type ProjectIcons = ReadonlyMap<string, ProjectIconData | null>;

function iconSignature(projects: Board["projects"]): string {
  return projects
    .map((project) => `${project.id}:${project.iconRevision ?? ""}`)
    .sort()
    .join("\u0000");
}

export function useProjectIcons(
  hostId: string,
  projects: Board["projects"],
): ProjectIcons {
  const call = useRpc(projectIconsRpc);
  const signature = iconSignature(projects);
  const query = useQuery({
    queryKey: ["power-workboard", "project-icons", hostId, signature],
    queryFn: () => call({}),
    staleTime: Infinity,
    refetchInterval: 60_000,
  });
  return useMemo(
    () =>
      new Map(
        (query.data?.projects ?? []).map((project) => [
          project.id,
          project.icon,
        ]),
      ),
    [query.data],
  );
}

export function projectIconFor(
  icons: ProjectIcons,
  projectId: string | null | undefined,
): ProjectIconData | null {
  return (projectId && icons.get(projectId)) || null;
}
