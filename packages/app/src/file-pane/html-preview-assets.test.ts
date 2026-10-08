import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  createPreviewAssetLoader,
  parsePreviewAssetRequest,
  resolvePreviewAssetPath,
} from "@/file-pane/html-preview-assets";

const HTML = "/home/me/docs/gallery/index.html";

describe("resolvePreviewAssetPath", () => {
  it("resolves images in the HTML file's folder and below", () => {
    expect(resolvePreviewAssetPath(HTML, "images/00-previous.png")).toBe(
      "/home/me/docs/gallery/images/00-previous.png",
    );
    expect(resolvePreviewAssetPath(HTML, "./a.JPG")).toBe("/home/me/docs/gallery/a.JPG");
    expect(resolvePreviewAssetPath(HTML, "images/../b.webp")).toBe("/home/me/docs/gallery/b.webp");
  });

  it("drops the query and fragment and decodes percent escapes", () => {
    expect(resolvePreviewAssetPath(HTML, "images/a%20b.png?v=2#x")).toBe(
      "/home/me/docs/gallery/images/a b.png",
    );
  });

  it("resolves against workspace-relative and home-relative HTML paths", () => {
    expect(resolvePreviewAssetPath("docs/index.html", "a.svg")).toBe("docs/a.svg");
    expect(resolvePreviewAssetPath("index.html", "a.svg")).toBe("a.svg");
    expect(resolvePreviewAssetPath("~/plans/index.html", "a.gif")).toBe("~/plans/a.gif");
  });

  it("refuses paths that climb above the HTML file's folder", () => {
    expect(resolvePreviewAssetPath(HTML, "../before.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "images/../../before.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "%2e%2e/before.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "..\\before.png")).toBeNull();
  });

  it("refuses URLs with a scheme or host and root-relative paths", () => {
    expect(resolvePreviewAssetPath(HTML, "https://example.com/a.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "file:///etc/a.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "data:image/png;base64,AAAA")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "blob:null/1")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "//example.com/a.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "/etc/a.png")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "#a.png")).toBeNull();
  });

  it("refuses files that are not images", () => {
    expect(resolvePreviewAssetPath(HTML, "manifest.json")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, ".env")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "images/")).toBeNull();
    expect(resolvePreviewAssetPath(HTML, "%E0%A4%A.png")).toBeNull();
  });
});

describe("createPreviewAssetLoader", () => {
  it("reads the resolved path through the daemon and types it by extension", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const readFile = vi.fn(async () => ({ bytes, mime: "application/octet-stream" }));
    const client = { readFile } as unknown as DaemonClient;
    const load = createPreviewAssetLoader({ client, cwd: "/", htmlPath: HTML });

    expect(await load("images/a.svg")).toEqual({ bytes, mime: "image/svg+xml" });
    expect(readFile).toHaveBeenCalledWith(
      "/",
      "/home/me/docs/gallery/images/a.svg",
      undefined,
      expect.any(Number),
    );
  });

  it("never reads a refused path", async () => {
    const readFile = vi.fn();
    const client = { readFile } as unknown as DaemonClient;
    const load = createPreviewAssetLoader({ client, cwd: "/", htmlPath: HTML });

    expect(await load("../../.ssh/id_ed25519.png")).toBeNull();
    expect(await load("manifest.json")).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("parsePreviewAssetRequest", () => {
  it("accepts only well-formed requests", () => {
    expect(
      parsePreviewAssetRequest({ type: "paseo-preview-asset-request", id: "t:1", url: "a.png" }),
    ).toEqual({ id: "t:1", url: "a.png" });
    expect(parsePreviewAssetRequest({ type: "paseo-preview-asset-request", id: 1, url: "a" })).toBe(
      null,
    );
    expect(parsePreviewAssetRequest({ type: "other", id: "1", url: "a" })).toBeNull();
    expect(parsePreviewAssetRequest("a.png")).toBeNull();
  });
});
