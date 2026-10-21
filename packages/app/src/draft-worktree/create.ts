import type {
  CreateWorkspaceRequestOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import { useDesksStore } from "@/task-navigation/desks-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { type DraftWorktreeRequest, resolveDraftWorktreeNames } from "./model";

// CUSTOM(draft-worktree): creates the worktree, its workspace and the session's agent in one
// request, the way New workspace does, so the first message also names the branch when the user
// typed no name.
export async function createDraftAgentInWorktree(input: {
  client: DaemonClient;
  serverId: string;
  draftId: string;
  sourceDirectory: string;
  worktree: DraftWorktreeRequest;
  agent: NonNullable<CreateWorkspaceRequestOptions["agent"]>;
}): Promise<AgentSnapshotPayload> {
  const prompt = input.agent.initialPrompt?.trim();
  const payload = await input.client.createWorkspace({
    idempotencyKey: input.draftId,
    agent: input.agent,
    source: {
      kind: "worktree",
      cwd: input.sourceDirectory,
      projectId: input.worktree.projectId,
      ...resolveDraftWorktreeNames(input.worktree.name),
      ...(input.worktree.baseBranch ? { refName: input.worktree.baseBranch } : {}),
    },
    ...(prompt ? { firstAgentContext: { prompt } } : {}),
  });
  if (payload.error || !payload.workspace || !payload.agent) {
    throw new Error(payload.error ?? "Could not create the worktree");
  }
  getHostRuntimeStore().acceptWorkspaceSnapshots(input.serverId, [
    { ...normalizeWorkspaceDescriptor(payload.workspace), status: "running" },
  ]);
  return payload.agent;
}

/**
 * Points a Desk tab at the new worktree's workspace along with its agent. Returns false when the
 * tab is not on a Desk (workspace mode), where the caller retargets as usual.
 */
export function moveDeskTabToWorkspace(
  tabId: string,
  workspaceId: string,
  target: WorkspaceTabTarget,
): boolean {
  const store = useDesksStore.getState();
  if (!store.desks.some((desk) => desk.owners[tabId])) return false;
  store.updateTab(tabId, { workspaceId, target });
  return true;
}
