// CUSTOM(cache-warmup): Anthropic's prompt cache lives an hour after its last use. A big Claude
// session left idle loses it, and the next message pays to write the whole context again. A short
// message just before the hour runs out keeps it.

/** The prompt cache lasts this long after the last request. */
export const CACHE_TTL_MS = 60 * 60_000;
/** Ping this long after the last activity, before the cache runs out. */
export const WARM_AFTER_MS = 57 * 60_000;
/** Smaller sessions are cheap to rebuild and not worth a ping. */
export const MIN_CONTEXT_TOKENS = 100_000;
export const CACHE_WARMUP_PROVIDER = "claude";
export const CACHE_WARMUP_MESSAGE =
  "Keep-alive ping to keep the prompt cache warm. Reply with just: pong";

import type { StreamItem } from "@/types/stream";

export interface CacheWarmupCandidate {
  serverId: string;
  agentId: string;
  provider: string;
  status: string;
  contextTokens: number | null;
  /** When the session last sent a request to Claude, from `cacheLastUsedAt`; null if unknown. */
  lastCacheUseAt: number | null;
}

export function cacheWarmupAgentKey(serverId: string, agentId: string): string {
  return `${serverId}\u0000${agentId}`;
}

/**
 * When the session last used its prompt cache: the later of its last user message (the start of
 * its last turn) and the last time this app saw a turn start or end. The agent's `lastActivityAt`
 * can't be used: the daemon moves it for things that send nothing to Claude, such as reloading
 * the agent when Paseo reopens, a title change or a label write. A session reopened the next day
 * would look freshly active and get pinged 57 minutes later, paying to rebuild a cold cache.
 */
export function cacheLastUsedAt(input: {
  lastUserMessageAt: number | null;
  lastTurnSeenAt: number | null;
}): number | null {
  if (input.lastUserMessageAt === null) return input.lastTurnSeenAt;
  if (input.lastTurnSeenAt === null) return input.lastUserMessageAt;
  return Math.max(input.lastUserMessageAt, input.lastTurnSeenAt);
}

/**
 * Agents to ping now: idle Claude sessions over the token floor, open in a tab, whose cache is
 * between 57 and 60 minutes old. Past the hour the cache is gone, so pinging would only pay to
 * rebuild it; that also keeps tabs left open for days from being pinged. Sessions whose composer
 * toggle is off (`disabledAgentKeys`, keyed by `cacheWarmupAgentKey`) are skipped.
 */
export function pickAgentsToWarm(input: {
  candidates: readonly CacheWarmupCandidate[];
  openAgentIds: ReadonlySet<string>;
  disabledAgentKeys: ReadonlySet<string>;
  now: number;
}): CacheWarmupCandidate[] {
  return input.candidates.filter((candidate) => {
    if (candidate.provider !== CACHE_WARMUP_PROVIDER || candidate.status !== "idle") return false;
    if (input.disabledAgentKeys.has(cacheWarmupAgentKey(candidate.serverId, candidate.agentId))) {
      return false;
    }
    if ((candidate.contextTokens ?? 0) <= MIN_CONTEXT_TOKENS) return false;
    if (!input.openAgentIds.has(candidate.agentId)) return false;
    if (candidate.lastCacheUseAt === null) return false;
    const idleFor = input.now - candidate.lastCacheUseAt;
    return idleFor >= WARM_AFTER_MS && idleFor < CACHE_TTL_MS;
  });
}

/** The composer toggle's tooltip: whether pings are on, and how long until the cache goes cold. */
export function describeCacheWarmup(input: {
  enabled: boolean;
  status: string;
  contextTokens: number | null;
  lastCacheUseAt: number | null;
  now: number;
}): string[] {
  const lines = [input.enabled ? "Keep cache warm: on" : "Keep cache warm: off"];
  if (input.status === "running") {
    lines.push("Cache in use");
  } else {
    const minutesLeft =
      input.lastCacheUseAt === null
        ? 0
        : Math.ceil((input.lastCacheUseAt + CACHE_TTL_MS - input.now) / 60_000);
    lines.push(minutesLeft > 0 ? `Cold in ${minutesLeft} min` : "Cache is cold");
  }
  if (input.enabled && (input.contextTokens ?? 0) <= MIN_CONTEXT_TOKENS) {
    lines.push("Pings start above 100k tokens");
  }
  return lines;
}

function isCacheWarmupPing(item: StreamItem): boolean {
  return item.kind === "user_message" && item.text.trim() === CACHE_WARMUP_MESSAGE;
}

function dropPingTurns(
  items: StreamItem[],
  hidingAtStart: boolean,
): { items: StreamItem[]; hidingAtEnd: boolean } {
  let hiding = hidingAtStart;
  let kept: StreamItem[] | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "user_message") hiding = isCacheWarmupPing(item);
    if (hiding) {
      kept ??= items.slice(0, index);
    } else {
      kept?.push(item);
    }
  }
  return { items: kept ?? items, hidingAtEnd: hiding };
}

/**
 * Hides each ping and its reply (everything up to the next user message) from the chat. The live
 * head continues the tail's last turn, so a reply still streaming after a ping stays hidden too.
 * Returns the same arrays when nothing is hidden.
 */
export function hideCacheWarmupTurns(
  tail: StreamItem[],
  head: StreamItem[],
): { tail: StreamItem[]; head: StreamItem[] } {
  const filteredTail = dropPingTurns(tail, false);
  const filteredHead = dropPingTurns(head, filteredTail.hidingAtEnd);
  return { tail: filteredTail.items, head: filteredHead.items };
}
