// CUSTOM(assistant-desk): one place for the composer's client slash commands. The pane context's
// close drops the tab plainly in every host (Desk, workspace pane), so `/exit`
// archives the agent once here instead of also going through the tab button's guarded close.
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { clientSlashCommandArchivesAgent } from "./clear-keeps-agent";
import type { ClientSlashCommand } from "./index";

export interface ClientSlashCommandEffects {
  /** Unpin and hide the agent in its workspace, so a later reconcile does not reopen it. */
  detachFromLayout(): void;
  buildDraftTarget(): WorkspaceTabTarget;
  retargetCurrentTab(target: WorkspaceTabTarget): void;
  closeCurrentTab(): void;
  archiveAgent(): Promise<void>;
}

export async function runClientSlashCommand(
  command: ClientSlashCommand,
  effects: ClientSlashCommandEffects,
): Promise<void> {
  effects.detachFromLayout();
  if (command.kind === "replace-agent-with-draft") {
    effects.retargetCurrentTab(effects.buildDraftTarget());
    return;
  }
  effects.closeCurrentTab();
  if (!clientSlashCommandArchivesAgent(command)) return;
  await effects.archiveAgent();
}
