import { describe, expect, it } from "vitest";
import {
  buildHtmlPreviewCsp,
  createHtmlPreviewService,
  mimeForPreviewPath,
  parseHtmlPreviewReadResponse,
  parseHtmlPreviewRequestUrl,
  type HtmlPreviewReadRequest,
} from "./html-preview-protocol";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("parseHtmlPreviewRequestUrl", () => {
  it("returns the token and decoded path", () => {
    expect(parseHtmlPreviewRequestUrl(`paseo-preview://${TOKEN}/docs/a%20b.html?v=2#x`)).toEqual({
      token: TOKEN,
      path: "docs/a b.html",
    });
  });

  it("lets the URL parser collapse dot segments so they cannot climb", () => {
    expect(parseHtmlPreviewRequestUrl(`paseo-preview://${TOKEN}/a/../../%2e%2e/b.html`)?.path).toBe(
      "b.html",
    );
  });

  it.each([
    `paseo-preview://${TOKEN}/`,
    `paseo-preview://${TOKEN}`,
    `paseo-preview://${TOKEN}/a%5C..%5Cb.html`,
    `paseo-preview://${TOKEN}/a%00.html`,
    `paseo-preview://${TOKEN}//etc/passwd`,
    `paseo-preview://${TOKEN}/%E0%A4%A`,
    `paseo-preview://nothex/index.html`,
    `https://${TOKEN}/index.html`,
    "not a url",
  ])("rejects %s", (url) => {
    expect(parseHtmlPreviewRequestUrl(url)).toBeNull();
  });
});

describe("mimeForPreviewPath", () => {
  it("maps extensions and adds charset to text types", () => {
    expect(mimeForPreviewPath("a/b.HTML")).toBe("text/html; charset=utf-8");
    expect(mimeForPreviewPath("x.mjs")).toBe("text/javascript; charset=utf-8");
    expect(mimeForPreviewPath("x.css")).toBe("text/css; charset=utf-8");
    expect(mimeForPreviewPath("x.json")).toBe("application/json; charset=utf-8");
    expect(mimeForPreviewPath("x.svg")).toBe("image/svg+xml");
    expect(mimeForPreviewPath("x.woff2")).toBe("font/woff2");
    expect(mimeForPreviewPath("x.unknown")).toBe("application/octet-stream");
    expect(mimeForPreviewPath("noext")).toBe("application/octet-stream");
  });
});

describe("buildHtmlPreviewCsp", () => {
  it("allows only the token origin, forbids network, and sandboxes", () => {
    const csp = buildHtmlPreviewCsp(`paseo-preview://${TOKEN}`);
    expect(csp).toContain(`script-src paseo-preview://${TOKEN} 'unsafe-inline'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp.endsWith("sandbox allow-scripts")).toBe(true);
  });
});

describe("parseHtmlPreviewReadResponse", () => {
  it("accepts well-formed payloads only", () => {
    expect(parseHtmlPreviewReadResponse({ requestId: "1", status: "not-found" })).toEqual({
      requestId: "1",
      status: "not-found",
    });
    expect(
      parseHtmlPreviewReadResponse({ requestId: "1", status: "ok", bytes: new Uint8Array(1) }),
    ).not.toBeNull();
    expect(parseHtmlPreviewReadResponse({ requestId: "1", status: "ok", bytes: "x" })).toBeNull();
    expect(parseHtmlPreviewReadResponse({ status: "not-found" })).toBeNull();
    expect(parseHtmlPreviewReadResponse(null)).toBeNull();
  });
});

describe("html preview service", () => {
  function setup(timeoutMs = 1000) {
    const sent: Array<{ id: number; request: HtmlPreviewReadRequest }> = [];
    const service = createHtmlPreviewService({
      sendReadRequest: (id, request) => {
        sent.push({ id, request });
        return true;
      },
      timeoutMs,
    });
    return { service, sent };
  }

  it("serves bytes from the owning renderer with the response policy", async () => {
    const { service, sent } = setup();
    const token = service.open(7);
    const pending = service.handleRequest(`paseo-preview://${token}/docs/index.html`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBe(7);
    expect(sent[0]?.request).toMatchObject({ token, path: "docs/index.html" });
    service.respond(7, {
      requestId: sent[0]?.request.requestId,
      status: "ok",
      bytes: new Uint8Array([1, 2]),
    });
    const result = await pending;
    expect(result.status).toBe(200);
    expect(result.body).toEqual(new Uint8Array([1, 2]));
    expect(result.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(result.headers["Content-Security-Policy"]).toContain(`paseo-preview://${token}`);
    expect(result.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("ignores responses from a different renderer", async () => {
    const { service, sent } = setup(20);
    const token = service.open(7);
    const pending = service.handleRequest(`paseo-preview://${token}/a.html`);
    service.respond(8, {
      requestId: sent[0]?.request.requestId,
      status: "ok",
      bytes: new Uint8Array(1),
    });
    expect((await pending).status).toBe(504);
  });

  it("returns 404 for unknown tokens, closed tokens, and not-found reads", async () => {
    const { service, sent } = setup();
    expect((await service.handleRequest(`paseo-preview://${TOKEN}/a.html`)).status).toBe(404);
    const token = service.open(1);
    const pending = service.handleRequest(`paseo-preview://${token}/a.html`);
    service.respond(1, { requestId: sent[0]?.request.requestId, status: "not-found" });
    const missing = await pending;
    expect(missing.status).toBe(404);
    expect(missing.headers["Content-Security-Policy"]).toBeDefined();
  });

  it("only the owner can close a token", async () => {
    const { service, sent } = setup(20);
    const token = service.open(1);
    service.close(token, 2);
    void service.handleRequest(`paseo-preview://${token}/a.html`);
    expect(sent).toHaveLength(1);
    service.close(token, 1);
    expect((await service.handleRequest(`paseo-preview://${token}/a.html`)).status).toBe(404);
  });

  it("drops tokens and rejects pending reads when the renderer is destroyed", async () => {
    const { service } = setup();
    const token = service.open(3);
    const pending = service.handleRequest(`paseo-preview://${token}/a.html`);
    service.dropWebContents(3);
    expect((await pending).status).toBe(404);
    expect((await service.handleRequest(`paseo-preview://${token}/a.html`)).status).toBe(404);
  });
});
