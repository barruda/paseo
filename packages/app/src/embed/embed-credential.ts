// CUSTOM(agent-embed): the serving daemon issues a short-lived single-use ticket to its own page.
import type { HostConnection } from "@/types/host-connection";
import { isEmbedMode } from "@/embed/embed-mode";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeAuthority(input: string, defaultPort: string): string | null {
  try {
    const url = new URL(`http://${input.trim()}`);
    const hostname = LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
      ? "localhost"
      : url.hostname.toLowerCase();
    return `${hostname}:${url.port || defaultPort}`;
  } catch {
    return null;
  }
}

/** True only for a direct connection to the daemon that serves this page. */
export function shouldUseEmbedCredential(input: {
  embedMode: boolean;
  connection: HostConnection;
  locationHost: string;
  locationProtocol?: string;
}): boolean {
  if (!input.embedMode || input.connection.type !== "directTcp" || !input.locationHost) {
    return false;
  }
  const defaultPort = input.locationProtocol === "https:" ? "443" : "80";
  const connectionAuthority = normalizeAuthority(input.connection.endpoint, defaultPort);
  const pageAuthority = normalizeAuthority(input.locationHost, defaultPort);
  return connectionAuthority !== null && connectionAuthority === pageAuthority;
}

export async function fetchEmbedTicket(
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl("/api/embed/credential", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Paseo-Embed": "1" },
    });
    if (!response.ok) {
      return undefined;
    }
    const json: unknown = await response.json();
    const ticket =
      json && typeof json === "object" ? (json as { ticket?: unknown }).ticket : undefined;
    return typeof ticket === "string" && ticket.length > 0 ? ticket : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolver for `localCredential`. Tickets are single-use, so this runs on every
 * connect and reconnect. Falls back to `fallback` outside embed mode or for other hosts.
 */
export function resolveLocalCredentialForConnection(
  connection: HostConnection,
  fallback: (connection: HostConnection) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (
    shouldUseEmbedCredential({
      embedMode: isEmbedMode(),
      connection,
      locationHost: typeof window === "undefined" ? "" : window.location.host,
      locationProtocol: typeof window === "undefined" ? undefined : window.location.protocol,
    })
  ) {
    return fetchEmbedTicket();
  }
  return fallback(connection);
}
