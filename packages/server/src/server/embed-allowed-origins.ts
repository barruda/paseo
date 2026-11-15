// CUSTOM(agent-embed): only exact http(s) origins may frame the web UI.
export interface NormalizedEmbedAllowedOrigins {
  origins: string[];
  rejected: string[];
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

export function normalizeEmbedAllowedOrigins(
  values: readonly string[],
): NormalizedEmbedAllowedOrigins {
  const origins: string[] = [];
  const rejected: string[] = [];
  for (const value of values) {
    if (!isExactHttpOrigin(value)) {
      rejected.push(value);
    } else if (!origins.includes(value)) {
      origins.push(value);
    }
  }
  return { origins, rejected };
}
