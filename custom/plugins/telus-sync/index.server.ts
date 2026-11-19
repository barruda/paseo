// CUSTOM(telus-sync): sync from Paseo Personal only; file policy is in shared/model.ts.
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { emptyRunResult, type RunResult } from "./shared/model";
import {
  telusSyncHistoryRpc,
  telusSyncPreviewRpc,
  telusSyncRollbackRpc,
  telusSyncRunRpc,
  telusSyncStatusRpc,
} from "./shared/rpc";
import {
  buildPlan,
  executeSync,
  listHistory,
  resolveSyncPaths,
  rollbackSync,
  type SyncPaths,
} from "./server/sync";

export default function contribute(server: PluginServerContext) {
  // One sync or rollback at a time: both write the same files.
  let busy = false;
  const paths = (): SyncPaths => {
    const status = resolveSyncPaths();
    if (!status.available)
      throw new Error(status.reason ?? "The Telus sync is unavailable.");
    return status;
  };
  const guarded = async (
    work: () => Promise<RunResult>,
  ): Promise<RunResult> => {
    if (busy)
      return emptyRunResult({
        error: "A sync or rollback is already running.",
      });
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  };

  server.handle(telusSyncStatusRpc, () => resolveSyncPaths());
  server.handle(telusSyncPreviewRpc, async ({ categories }) => ({
    categories: (await buildPlan(paths(), categories)).categories,
  }));
  server.handle(telusSyncRunRpc, ({ categories }) =>
    guarded(() => executeSync(paths(), categories)),
  );
  server.handle(telusSyncHistoryRpc, async () => {
    const status = resolveSyncPaths();
    return {
      entries: status.available ? await listHistory(status.backupRoot) : [],
    };
  });
  server.handle(telusSyncRollbackRpc, ({ backupId }) =>
    guarded(() => rollbackSync(paths(), backupId)),
  );
  return () => undefined;
}
