import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ShellCommandRunner } from "./server/runner";
import { runShellCommandRpc, sendShellInputRpc, stopShellCommandRpc } from "./shared/shell-command";

export default function contribute(server: PluginServerContext) {
  const runner = new ShellCommandRunner();
  server.handle(runShellCommandRpc, (input, context) => runner.run(input, context));
  server.handle(stopShellCommandRpc, (input) => runner.stop(input));
  server.handle(sendShellInputRpc, (input) => runner.input(input));
  return () => runner.stopAll();
}
