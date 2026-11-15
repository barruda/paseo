import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import { isLoopbackRemoteAddress } from "./loopback-address.js";

// CUSTOM(agent-embed): short-lived single-use tickets that let the embedded web UI
// authenticate its WebSocket without the daemon password.
export interface EmbedTicketStore {
  issue(): { ticket: string; expiresInMs: number };
  consume(token: string): boolean;
}

export interface EmbedTicketStoreOptions {
  ttlMs?: number;
  maxOutstanding?: number;
  now?: () => number;
}

export function createEmbedTicketStore(options: EmbedTicketStoreOptions = {}): EmbedTicketStore {
  const ttlMs = options.ttlMs ?? 60_000;
  const maxOutstanding = options.maxOutstanding ?? 32;
  const now = options.now ?? Date.now;
  // Map preserves insertion order, so the first key is the oldest ticket.
  const tickets = new Map<string, number>();

  function prune(): void {
    const current = now();
    for (const [ticket, expiresAt] of tickets) {
      if (expiresAt <= current) {
        tickets.delete(ticket);
      }
    }
  }

  return {
    issue() {
      prune();
      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, now() + ttlMs);
      while (tickets.size > maxOutstanding) {
        const oldest = tickets.keys().next().value;
        if (oldest === undefined) break;
        tickets.delete(oldest);
      }
      return { ticket, expiresInMs: ttlMs };
    },
    consume(token) {
      prune();
      return tickets.delete(token);
    },
  };
}

export interface EmbedCredentialRouteHandlerOptions {
  store: EmbedTicketStore;
  isWebUiEnabled: () => boolean;
  logger: Logger;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createEmbedCredentialRouteHandler(
  options: EmbedCredentialRouteHandlerOptions,
): RequestHandler {
  const { store, isWebUiEnabled } = options;
  const logger = options.logger.child({ module: "embed-credential" });

  function findRejection(req: Parameters<RequestHandler>[0]): string | null {
    if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) return "non_loopback_remote";
    const host = firstHeader(req.headers.host);
    if (!host) return "missing_host";
    const origin = firstHeader(req.headers.origin);
    if (origin !== `${req.protocol}://${host}`) return "origin_mismatch";
    if (firstHeader(req.headers["sec-fetch-site"]) !== "same-origin") return "sec_fetch_site";
    if (firstHeader(req.headers["sec-fetch-dest"]) !== "empty") return "sec_fetch_dest";
    const mode = firstHeader(req.headers["sec-fetch-mode"]);
    if (mode !== "cors" && mode !== "same-origin") return "sec_fetch_mode";
    if (firstHeader(req.headers["x-paseo-embed"]) !== "1") return "missing_embed_header";
    return null;
  }

  return (req, res) => {
    if (!isWebUiEnabled()) {
      res.status(404).end();
      return;
    }
    const rejection = findRejection(req);
    if (rejection) {
      logger.warn({ reason: rejection }, "Rejected embed credential request");
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(store.issue());
  };
}
