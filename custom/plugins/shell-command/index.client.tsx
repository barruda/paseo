import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ShellCommandCard } from "./client/shell-command-card";
import {
  runShellCommandRpc,
  SHELL_COMMAND_TIMELINE_KIND,
  SHELL_COMMAND_TIMELINE_VERSION,
  shellCommandTimelineSchema,
} from "./shared/shell-command";

export default function contribute(client: PluginClientContext) {
  const removeCommand = client.addSlashCommand({
    // The composer also routes `!<command>` here (custom patch in
    // packages/app/src/plugins/client-slash-commands/model.ts).
    name: "sh",
    description:
      "Run a shell command in the agent's directory. Output stays in the chat; the agent never sees it.",
    argumentHint: "<command>",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      if (!args) throw new Error("Type a command: !ls or /sh ls");
      await rpc(runShellCommandRpc, { agentId: agent.id, cwd: agent.cwd, command: args });
    },
  });
  const removeRenderer = client.addTimelineRenderer({
    kind: SHELL_COMMAND_TIMELINE_KIND,
    version: SHELL_COMMAND_TIMELINE_VERSION,
    schema: shellCommandTimelineSchema,
    Component: ShellCommandCard,
  });
  return () => {
    removeCommand();
    removeRenderer();
  };
}
