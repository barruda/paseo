/**
 * Output tokens over the turn's wall-clock duration. Providers report output
 * tokens and TokenLedger records `durationMs` per turn, so the rate is derived
 * rather than reported. It includes tool waits inside the turn, so it runs
 * lower than a provider's generation rate.
 */
export function tokensPerSecond(output: number | null, durationMs: number | null): number | null {
  if (output === null || durationMs === null) return null;
  if (!Number.isFinite(output) || !Number.isFinite(durationMs)) return null;
  if (output <= 0 || durationMs <= 0) return null;
  const rate = output / (durationMs / 1000);
  return rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10;
}

export function formatTokensPerSecond(
  output: number | null,
  durationMs: number | null,
): string | null {
  const rate = tokensPerSecond(output, durationMs);
  return rate === null ? null : `${rate} tok/s`;
}
