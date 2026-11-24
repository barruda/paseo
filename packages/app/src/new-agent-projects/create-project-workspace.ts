// CUSTOM(new-agent-projects): gives a project added without a workspace one in its root, and puts
// it in the session store. The + menu's Agent flyout and the empty agent tab's project picker use it.
import type { useHostRuntimeClient } from "@/runtime/host-runtime";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { generateDraftId } from "@/stores/draft-keys";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";

export async function createProjectWorkspace(
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>,
  serverId: string,
  project: { projectId: string; rootPath: string },
): Promise<WorkspaceDescriptor> {
  const payload = await client.createWorkspace({
    idempotencyKey: generateDraftId(),
    source: { kind: "directory", path: project.rootPath, projectId: project.projectId },
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? "Could not open the project");
  }
  const workspace = normalizeWorkspaceDescriptor(payload.workspace);
  getHostRuntimeStore().acceptWorkspaceSnapshots(serverId, [workspace]);
  return workspace;
}
