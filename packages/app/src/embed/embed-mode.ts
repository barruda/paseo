// CUSTOM(agent-embed): embed mode renders one agent conversation, no app chrome, in an iframe.
import { isWeb } from "@/constants/platform";

export interface EmbedTarget {
  serverId: string;
  agentId: string;
}

/** Parses `/h/<serverId>/agent/<agentId>?embed=1`. Anything else is not an embed URL. */
export function parseEmbedLocation(pathname: string, search: string): EmbedTarget | null {
  const embed = new URLSearchParams(search).get("embed");
  if (embed !== "1") {
    return null;
  }
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 4 || segments[0] !== "h" || segments[2] !== "agent") {
    return null;
  }
  try {
    const serverId = decodeURIComponent(segments[1] ?? "").trim();
    const agentId = decodeURIComponent(segments[3] ?? "").trim();
    return serverId && agentId ? { serverId, agentId } : null;
  } catch {
    return null;
  }
}

function readInitialEmbedTarget(): EmbedTarget | null {
  if (!isWeb || typeof window === "undefined" || !window.location) {
    return null;
  }
  return parseEmbedLocation(window.location.pathname, window.location.search);
}

// Read once: router navigation may drop the query string, but the page stays an embed.
const initialEmbedTarget = readInitialEmbedTarget();

export function isEmbedMode(): boolean {
  return initialEmbedTarget !== null;
}

export function getEmbedTarget(): EmbedTarget | null {
  return initialEmbedTarget;
}
