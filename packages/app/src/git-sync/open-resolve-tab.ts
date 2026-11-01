// CUSTOM(git-sync): "Resolver conflitos" opens a new tab whose draft holds the resolve prompt,
// unsent. The composer mounts with the caret after the text, so the user reviews and sends it.
import { buildDraftAgentSetup } from "@/client-slash-commands";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { buildResolveConflictsPrompt, type GitConflicts } from "./model";

/** An open workspace whose directory is `dir`, for conflicts in another checkout. */
function findWorkspaceForDirectory(serverId: string, dir: string): string | null {
  const target = normalizeWorkspacePath(dir);
  if (!target) return null;
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  for (const workspace of workspaces?.values() ?? []) {
    if (workspace.archivingAt) continue;
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === target) return workspace.id;
  }
  return null;
}

export function openResolveConflictsTab(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  conflicts: GitConflicts;
  /** True when the conflicts are in the agent's own checkout; false for the main checkout. */
  ownCheckout: boolean;
}): void {
  const { serverId, agentId, conflicts, ownCheckout } = input;
  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  if (!agent) throw new Error("Agente não encontrado");

  // The agent's own path keeps its spelling (a symlinked worktree stays under its link); the main
  // checkout opens in its own workspace when one is open, else beside this one.
  const cwd = ownCheckout ? agent.cwd : conflicts.dir;
  const workspaceId = ownCheckout
    ? input.workspaceId
    : (findWorkspaceForDirectory(serverId, conflicts.dir) ?? input.workspaceId);

  const draftId = generateDraftId();
  useDraftStore.getState().saveDraftInput({
    draftKey: buildDraftStoreKey({ serverId, agentId: "", draftId }),
    draft: { text: buildResolveConflictsPrompt(conflicts), attachments: [] },
  });
  navigateToWorkspace({
    serverId,
    workspaceId,
    target: { kind: "draft", draftId, setup: { ...buildDraftAgentSetup(agent), cwd } },
  });
}
