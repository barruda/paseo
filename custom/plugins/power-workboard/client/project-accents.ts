// CUSTOM(project-icon-colors): the assistant pages have no board snapshot, so they read the
// same project accents from one small RPC and resolve a task's project by id, then by name.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import type { ProjectAccent } from "../shared/model";
import { projectAccentsRpc } from "../shared/rpc";

export interface ProjectAccents {
  forProject(
    id: string | null | undefined,
    name?: string | null,
  ): ProjectAccent | null;
}

export function useProjectAccents(hostId: string): ProjectAccents {
  const call = useRpc(projectAccentsRpc);
  const query = useQuery({
    queryKey: ["power-workboard", "project-accents", hostId],
    queryFn: () => call({}),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return useMemo(() => {
    const byId = new Map<string, ProjectAccent | null>();
    const byName = new Map<string, ProjectAccent | null>();
    for (const project of query.data?.projects ?? []) {
      byId.set(project.id, project.accent);
      if (!byName.has(project.name)) byName.set(project.name, project.accent);
    }
    return {
      forProject(id, name) {
        if (id && byId.has(id)) return byId.get(id) ?? null;
        return (name ? byName.get(name) : null) ?? null;
      },
    };
  }, [query.data]);
}
