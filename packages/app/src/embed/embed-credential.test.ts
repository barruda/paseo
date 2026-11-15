import { describe, expect, it, vi } from "vitest";
import type { HostConnection } from "@/types/host-connection";
import { fetchEmbedTicket, shouldUseEmbedCredential } from "./embed-credential";

function response(init: { ok: boolean; json: () => Promise<unknown> }): Response {
  return init as unknown as Response;
}

describe("fetchEmbedTicket", () => {
  it("posts with the embed header and returns the ticket", async () => {
    const fetchMock = vi.fn(async () =>
      response({ ok: true, json: async () => ({ ticket: "t-123" }) }),
    );
    await expect(fetchEmbedTicket(fetchMock as unknown as typeof fetch)).resolves.toBe("t-123");
    expect(fetchMock).toHaveBeenCalledWith("/api/embed/credential", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Paseo-Embed": "1" },
    });
  });

  it("returns undefined on 403", async () => {
    const fetchMock = vi.fn(async () => response({ ok: false, json: async () => ({}) }));
    await expect(fetchEmbedTicket(fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
  });

  it("returns undefined on a network error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(fetchEmbedTicket(fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
  });

  it("returns undefined on bad JSON or a non-string ticket", async () => {
    const badJson = vi.fn(async () =>
      response({
        ok: true,
        json: async () => {
          throw new SyntaxError("bad");
        },
      }),
    );
    await expect(fetchEmbedTicket(badJson as unknown as typeof fetch)).resolves.toBeUndefined();
    const wrongType = vi.fn(async () => response({ ok: true, json: async () => ({ ticket: 5 }) }));
    await expect(fetchEmbedTicket(wrongType as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});

describe("shouldUseEmbedCredential", () => {
  const tcp = (endpoint: string): HostConnection => ({
    id: "c1",
    type: "directTcp",
    endpoint,
  });

  it("is true for the serving daemon in embed mode", () => {
    expect(
      shouldUseEmbedCredential({
        embedMode: true,
        connection: tcp("localhost:6767"),
        locationHost: "localhost:6767",
      }),
    ).toBe(true);
  });

  it("treats loopback aliases and default ports as the same host", () => {
    expect(
      shouldUseEmbedCredential({
        embedMode: true,
        connection: tcp("127.0.0.1:6767"),
        locationHost: "localhost:6767",
      }),
    ).toBe(true);
    expect(
      shouldUseEmbedCredential({
        embedMode: true,
        connection: tcp("example.test:443"),
        locationHost: "example.test",
        locationProtocol: "https:",
      }),
    ).toBe(true);
  });

  it("is false outside embed mode", () => {
    expect(
      shouldUseEmbedCredential({
        embedMode: false,
        connection: tcp("localhost:6767"),
        locationHost: "localhost:6767",
      }),
    ).toBe(false);
  });

  it("is false for another host or port", () => {
    expect(
      shouldUseEmbedCredential({
        embedMode: true,
        connection: tcp("other.test:6767"),
        locationHost: "localhost:6767",
      }),
    ).toBe(false);
    expect(
      shouldUseEmbedCredential({
        embedMode: true,
        connection: tcp("localhost:7000"),
        locationHost: "localhost:6767",
      }),
    ).toBe(false);
  });

  it("is false for non-direct connections", () => {
    expect(
      shouldUseEmbedCredential({
        embedMode: true,
        connection: { id: "r", type: "routed", originServerId: "x" },
        locationHost: "localhost:6767",
      }),
    ).toBe(false);
  });
});
