// CUSTOM(cache-warmup): the keep-alive prompt the app sends to keep an idle Claude session's
// prompt cache warm. Shared so the daemon can tell a ping's turn apart from real work.

export const CACHE_WARMUP_MESSAGE =
  "Keep-alive ping to keep the prompt cache warm. Reply with just: pong";

export function isCacheWarmupMessage(text: string): boolean {
  return text.trim() === CACHE_WARMUP_MESSAGE;
}
