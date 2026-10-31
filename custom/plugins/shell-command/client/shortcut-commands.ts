import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { runShellCommandRpc } from "../shared/shell-command";

/**
 * Slash commands that run a fixed shell command, as if typed after `!`. `/wip` is the composer's
 * **Commit: wip** pill as a command; keep it in step with `COMMIT_WIP_COMMAND` in
 * packages/app/src/composer/commit-wip-pill-model.ts.
 */
export const SHELL_SHORTCUTS = [
  {
    name: "wip",
    description: "Commit everything as 'wip' (same as the Commit: wip pill)",
    command: "git add . && git commit -m 'wip'",
  },
  { name: "status", description: "Run git status in the agent's directory", command: "git status" },
] as const;

export function addShortcutCommands(
  client: Pick<PluginClientContext, "addSlashCommand">,
): PluginCleanup[] {
  return SHELL_SHORTCUTS.map((shortcut) =>
    client.addSlashCommand({
      name: shortcut.name,
      description: shortcut.description,
      argumentHint: "",
      context: "agent",
      async onSubmit({ agent, rpc }) {
        await rpc(runShellCommandRpc, {
          agentId: agent.id,
          cwd: agent.cwd,
          command: shortcut.command,
          workspaceId: agent.workspaceId,
        });
      },
    }),
  );
}
