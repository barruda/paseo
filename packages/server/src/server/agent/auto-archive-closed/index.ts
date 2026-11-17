// CUSTOM(auto-archive-closed): archives agents that have had no runtime for a while. The decision
// is a pure function over plain records; the sweep only schedules it and archives one at a time.
import type { Logger } from "pino";

const DAY_MS = 24 * 60 * 60_000;
// CUSTOM(auto-archive-closed): give clients time to report their open tabs after a restart.
const DEFAULT_INITIAL_DELAY_MS = 10 * 60_000;
const DEFAULT_INTERVAL_MS = 60 * 60_000;

export interface AutoArchiveRecord {
  id: string;
  parentAgentId: string | null;
  archived: boolean;
  /** A runtime exists in AgentManager. */
  live: boolean;
  /** Some client has a tab open for it (idle-open-tab label "true"). */
  hasOpenTab: boolean;
  updatedAt: number;
}

/**
 * Ids to archive. An agent qualifies when it is closed, unarchived, unwatched and idle for more
 * than `days`, and so is every unarchived descendant: archiving cascades to children, and a live
 * or recently used child must never be archived through the parent. When a parent qualifies its
 * qualifying descendants are left to the cascade.
 */
export function selectAgentsToAutoArchive(
  records: readonly AutoArchiveRecord[],
  nowMs: number,
  days: number,
): string[] {
  if (!(days > 0)) return [];
  const cutoff = days * DAY_MS;
  const byParent = new Map<string, AutoArchiveRecord[]>();
  for (const record of records) {
    if (record.archived || record.parentAgentId === null) continue;
    byParent.set(record.parentAgentId, [...(byParent.get(record.parentAgentId) ?? []), record]);
  }
  const quiet = (record: AutoArchiveRecord) =>
    !record.live && !record.hasOpenTab && nowMs - record.updatedAt > cutoff;
  const qualifies = (record: AutoArchiveRecord, seen: Set<string>): boolean => {
    if (seen.has(record.id)) return true;
    seen.add(record.id);
    if (!quiet(record)) return false;
    return (byParent.get(record.id) ?? []).every((child) => qualifies(child, seen));
  };
  const qualifying = new Map<string, AutoArchiveRecord>();
  for (const record of records) {
    if (!record.archived && qualifies(record, new Set())) qualifying.set(record.id, record);
  }
  const selected: string[] = [];
  for (const record of qualifying.values()) {
    let ancestor = record.parentAgentId;
    let covered = false;
    for (let depth = 0; ancestor !== null && depth < 64; depth++) {
      if (qualifying.has(ancestor)) {
        covered = true;
        break;
      }
      ancestor = records.find((candidate) => candidate.id === ancestor)?.parentAgentId ?? null;
    }
    if (!covered) selected.push(record.id);
  }
  return selected;
}

interface Options {
  /** Days read at each sweep; 0 means off. */
  days(): number;
  records(): Promise<readonly AutoArchiveRecord[]>;
  /** Re-checks the agent right before archiving; false skips it. */
  stillEligible(id: string): Promise<boolean>;
  archive(id: string): Promise<void>;
  logger: Pick<Logger, "info" | "warn">;
  now?: () => number;
  initialDelayMs?: number;
  intervalMs?: number;
}

export function createAutoArchiveClosed(options: Options) {
  const now = options.now ?? Date.now;
  let stopped = false;
  let running: Promise<number> | null = null;

  async function run(): Promise<number> {
    const days = options.days();
    if (!(days > 0) || stopped) return 0;
    const timestamp = now();
    const records = await options.records();
    const byId = new Map(records.map((record) => [record.id, record]));
    let archived = 0;
    for (const id of selectAgentsToAutoArchive(records, timestamp, days)) {
      if (stopped || !(options.days() > 0)) break;
      try {
        if (!(await options.stillEligible(id))) continue;
        await options.archive(id);
        archived++;
        const ageDays = Math.floor((timestamp - (byId.get(id)?.updatedAt ?? timestamp)) / DAY_MS);
        options.logger.info({ agentId: id, ageDays }, "Auto-archived closed agent");
      } catch (error) {
        options.logger.warn({ agentId: id, err: error }, "Auto-archive of closed agent failed");
      }
    }
    if (archived > 0) options.logger.info({ archived }, "Auto-archive sweep finished");
    return archived;
  }
  function sweep(): Promise<number> {
    running ??= run()
      .catch((error) => {
        options.logger.warn({ err: error }, "Auto-archive sweep failed");
        return 0;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  const first = setTimeout(() => void sweep(), options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
  const timer = setInterval(() => void sweep(), options.intervalMs ?? DEFAULT_INTERVAL_MS);
  first.unref();
  timer.unref();
  return {
    sweep,
    async close() {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      await running;
    },
  };
}
