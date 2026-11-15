import http from "node:http";
import { once } from "node:events";
import express from "express";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { createEmbedCredentialRouteHandler, createEmbedTicketStore } from "./embed-credential.js";

const logger = pino({ level: "silent" });

describe("embed ticket store", () => {
  test("tickets are single use", () => {
    const store = createEmbedTicketStore();
    const { ticket } = store.issue();
    expect(store.consume(ticket)).toBe(true);
    expect(store.consume(ticket)).toBe(false);
    expect(store.consume("unknown")).toBe(false);
  });

  test("tickets expire", () => {
    let now = 1000;
    const store = createEmbedTicketStore({ ttlMs: 100, now: () => now });
    const live = store.issue();
    const stale = store.issue();
    now += 99;
    expect(store.consume(live.ticket)).toBe(true);
    now += 1;
    expect(store.consume(stale.ticket)).toBe(false);
    expect(live.expiresInMs).toBe(100);
  });

  test("evicts the oldest ticket past maxOutstanding", () => {
    const store = createEmbedTicketStore({ maxOutstanding: 2 });
    const a = store.issue();
    const b = store.issue();
    const c = store.issue();
    expect(store.consume(a.ticket)).toBe(false);
    expect(store.consume(b.ticket)).toBe(true);
    expect(store.consume(c.ticket)).toBe(true);
  });
});

interface Snapshot {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

async function post(options: {
  webUiEnabled?: boolean;
  headers?: (origin: string) => Record<string, string | undefined>;
  remoteAddress?: string;
}): Promise<Snapshot> {
  const app = express();
  if (options.remoteAddress) {
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", { value: options.remoteAddress });
      next();
    });
  }
  app.post(
    "/api/embed/credential",
    createEmbedCredentialRouteHandler({
      store: createEmbedTicketStore(),
      isWebUiEnabled: () => options.webUiEnabled ?? true,
      logger,
    }),
  );
  server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const host = `127.0.0.1:${address.port}`;
  const origin = `http://${host}`;
  const defaults: Record<string, string | undefined> = {
    host,
    origin,
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "x-paseo-embed": "1",
  };
  const merged = { ...defaults, ...options.headers?.(origin) };
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) headers[key] = value;
  }
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/embed/credential",
        method: "POST",
        headers,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
  let body = "";
  res.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf-8");
  });
  await once(res, "end");
  return { status: res.statusCode ?? 0, headers: res.headers, body };
}

describe("embed credential route", () => {
  test("issues a ticket for same-origin requests", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const parsed = JSON.parse(res.body) as { ticket: string; expiresInMs: number };
    expect(parsed.ticket.length).toBeGreaterThan(20);
    expect(parsed.expiresInMs).toBe(60_000);
  });

  test("accepts sec-fetch-mode same-origin", async () => {
    const res = await post({ headers: () => ({ "sec-fetch-mode": "same-origin" }) });
    expect(res.status).toBe(200);
  });

  const rejections: Array<[string, (origin: string) => Record<string, string | undefined>]> = [
    ["framing origin", () => ({ origin: "http://127.0.0.1:5178" })],
    ["CORS-allowed origin", () => ({ origin: "https://app.paseo.sh" })],
    ["missing origin", () => ({ origin: undefined })],
    ["cross-site", () => ({ "sec-fetch-site": "cross-site" })],
    ["same-site", () => ({ "sec-fetch-site": "same-site" })],
    ["missing sec-fetch-site", () => ({ "sec-fetch-site": undefined })],
    ["missing sec-fetch-dest", () => ({ "sec-fetch-dest": undefined })],
    ["missing sec-fetch-mode", () => ({ "sec-fetch-mode": undefined })],
    ["navigate mode", () => ({ "sec-fetch-mode": "navigate" })],
    ["missing x-paseo-embed", () => ({ "x-paseo-embed": undefined })],
  ];

  test.each(rejections)("refuses %s", async (_name, headers) => {
    const res = await post({ headers });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "Forbidden" });
  });

  test("refuses non-loopback remote addresses", async () => {
    const res = await post({ remoteAddress: "192.168.1.20" });
    expect(res.status).toBe(403);
  });

  test("returns 404 when the web UI is disabled", async () => {
    const res = await post({ webUiEnabled: false });
    expect(res.status).toBe(404);
  });
});
