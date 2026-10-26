import type { PluginClientSlashCommandContribution } from "@getpaseo/plugin/client";
import { describe, expect, it, vi } from "vitest";
import { runShellCommandRpc } from "../shared/shell-command";
import { addShortcutCommands } from "./shortcut-commands";

function contribute(): PluginClientSlashCommandContribution[] {
  const commands: PluginClientSlashCommandContribution[] = [];
  addShortcutCommands({
    addSlashCommand(command) {
      commands.push(command);
      return () => {};
    },
  });
  return commands;
}

async function submit(name: string) {
  const command = contribute().find((candidate) => candidate.name === name);
  if (command?.context !== "agent") throw new Error(`no agent command /${name}`);
  const rpc = vi.fn(async () => ({ id: "row" }));
  await command.onSubmit({
    args: "ignored",
    agent: { id: "agent-1", cwd: "/repo", workspaceId: "ws-1" },
    rpc,
  } as unknown as Parameters<typeof command.onSubmit>[0]);
  return rpc;
}

describe("shortcut commands", () => {
  it("/wip runs the Commit: wip pill's command", async () => {
    const rpc = await submit("wip");
    expect(rpc).toHaveBeenCalledWith(runShellCommandRpc, {
      agentId: "agent-1",
      cwd: "/repo",
      command: "git add . && git commit -m 'wip'",
      workspaceId: "ws-1",
    });
  });

  it("/status runs git status", async () => {
    const rpc = await submit("status");
    expect(rpc).toHaveBeenCalledWith(runShellCommandRpc, {
      agentId: "agent-1",
      cwd: "/repo",
      command: "git status",
      workspaceId: "ws-1",
    });
  });
});
