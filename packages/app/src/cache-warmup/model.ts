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

export interface CacheWarmupCandidate {
  serverId: string;
  agentId: string;
  provider: string;
  status: string;
  contextTokens: number | null;
  lastActivityAt: number;
}

/**
 * Agents to ping now: idle Claude sessions over the token floor, open in a tab, whose cache is
 * between 57 and 60 minutes old. Past the hour the cache is gone, so pinging would only pay to
 * rebuild it; that also keeps tabs left open for days from being pinged.
 */
export function pickAgentsToWarm(input: {
  candidates: readonly CacheWarmupCandidate[];
  openAgentIds: ReadonlySet<string>;
  now: number;
}): CacheWarmupCandidate[] {
  return input.candidates.filter((candidate) => {
    if (candidate.provider !== CACHE_WARMUP_PROVIDER || candidate.status !== "idle") return false;
    if ((candidate.contextTokens ?? 0) <= MIN_CONTEXT_TOKENS) return false;
    if (!input.openAgentIds.has(candidate.agentId)) return false;
    const idleFor = input.now - candidate.lastActivityAt;
    return idleFor >= WARM_AFTER_MS && idleFor < CACHE_TTL_MS;
  });
}
