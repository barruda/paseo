import type { PluginServerContext } from "@getpaseo/plugin/server";
import { completePath } from "./server/complete";
import { readGitSync } from "./server/git-sync";
import { postSyncReport } from "./server/sync-report";
import { defaultHistoryFile, HistoryKeyResolver, HistoryStore } from "./server/history";
import { ShellCommandRunner } from "./server/runner";
import {
  completePathRpc,
  gitSyncRpc,
  syncReportRpc,
  runShellCommandRpc,
  sendShellInputRpc,
  shellHistoryRpc,
  stopShellCommandRpc,
} from "./shared/shell-command";

export default function contribute(server: PluginServerContext) {
  const runner = new ShellCommandRunner();
  const history = new HistoryStore(defaultHistoryFile());
  const historyKeys = new HistoryKeyResolver();
  server.handle(runShellCommandRpc, (input, context) => {
    const result = runner.run(input, context);
    void historyKeys
      .resolve(input, context)
      .then((key) => history.add(key, input.command))
      .catch((error: unknown) => console.error("[shell-command] failed to save history", error));
    return result;
  });
  server.handle(stopShellCommandRpc, (input) => runner.stop(input));
  server.handle(sendShellInputRpc, (input) => runner.input(input));
  server.handle(shellHistoryRpc, async (input, context) => ({
    commands: await history.read(await historyKeys.resolve(input, context)),
  }));
  server.handle(completePathRpc, async (input) => ({ entries: await completePath(input) }));
  // CUSTOM(git-sync): conflicts and worktrees to bring in, for the composer's git chips.
  server.handle(gitSyncRpc, (input) => readGitSync(input.cwd));
  server.handle(syncReportRpc, postSyncReport);
  return () => runner.stopAll();
}
