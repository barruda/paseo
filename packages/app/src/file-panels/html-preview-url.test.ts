import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { withPreviewCsp, withPreviewPrologue } from "./html-preview-csp";
import {
  encodePreviewUrlPath,
  isSafeRequestPath,
  joinPreviewBase,
  previewUrl,
  readHtmlPreviewFile,
  resolveHtmlPreviewSource,
} from "./html-preview-url";

const client = {} as DaemonClient;

describe("resolveHtmlPreviewSource", () => {
  it("uses the workspace root as the base for a file inside it", () => {
    const source = resolveHtmlPreviewSource({
      client,
      htmlPath: "/work/proj/docs/index.html",
      workspaceRoot: "/work/proj",
    });
    expect(source).toMatchObject({ cwd: "/work/proj", base: "", path: "docs/index.html" });
  });

  it("accepts a workspace-relative path", () => {
    const source = resolveHtmlPreviewSource({
      client,
      htmlPath: "docs/index.html",
      workspaceRoot: "/work/proj",
    });
    expect(source).toMatchObject({ cwd: "/work/proj", base: "", path: "docs/index.html" });
  });

  it("uses the file's folder as the base for a file outside the workspace", () => {
    const source = resolveHtmlPreviewSource({
      client,
      htmlPath: "/tmp/plans/a/page.html",
      workspaceRoot: "/work/proj",
    });
    expect(source).toMatchObject({ cwd: "/", base: "/tmp/plans/a", path: "page.html" });
  });

  it("returns null without a client or a target", () => {
    expect(resolveHtmlPreviewSource({ client: null, htmlPath: "/a/b.html" })).toBeNull();
    expect(resolveHtmlPreviewSource({ client, htmlPath: "b.html" })).toBeNull();
  });
});

describe("preview URLs", () => {
  it("encodes each segment and keeps the separators", () => {
    expect(encodePreviewUrlPath("a b/c#d/é.html")).toBe("a%20b/c%23d/%C3%A9.html");
    expect(previewUrl("tok", "x y/z.html")).toBe("paseo-preview://tok/x%20y/z.html");
  });

  it("joins a base and a path", () => {
    expect(joinPreviewBase("", "a.css")).toBe("a.css");
    expect(joinPreviewBase("/tmp/x", "a.css")).toBe("/tmp/x/a.css");
    expect(joinPreviewBase("/", "a.css")).toBe("/a.css");
  });
});

describe("request path guard", () => {
  it("accepts plain relative paths", () => {
    expect(isSafeRequestPath("docs/a.html")).toBe(true);
  });

  it.each(["", "../a", "a/../b", "a\\..\\b", "/etc/passwd", "\\a", "C:/a", "a\0b"])(
    "rejects %j",
    (path) => {
      expect(isSafeRequestPath(path)).toBe(false);
    },
  );

  it("does not read a refused path", async () => {
    const reads: string[] = [];
    const source = {
      client: {
        readFile: async (_c: string, p: string) => (reads.push(p), { bytes: new Uint8Array() }),
      },
      cwd: "/w",
      base: "",
      path: "a.html",
    } as never;
    expect(await readHtmlPreviewFile(source, "../secret")).toEqual({ status: "not-found" });
    expect(reads).toEqual([]);
  });

  it("injects the prologue into html and passes other files through", async () => {
    const source = {
      client: {
        readFile: async (_c: string, p: string) => ({
          bytes: new TextEncoder().encode(p.endsWith(".css") ? "body{}" : "<p>hi</p>"),
        }),
      },
      cwd: "/w",
      base: "docs",
      path: "a.html",
    } as never;
    const html = await readHtmlPreviewFile(source, "a.html");
    const css = await readHtmlPreviewFile(source, "a.css");
    expect(html.status === "ok" && new TextDecoder().decode(html.bytes)).toMatch(
      /^<!doctype html><script>.*<p>hi<\/p>$/s,
    );
    expect(css.status === "ok" && new TextDecoder().decode(css.bytes)).toBe("body{}");
  });
});

describe("withPreviewPrologue", () => {
  it("puts the doctype first, then head markup, and strips a BOM", () => {
    expect(withPreviewPrologue("\uFEFF<p>x</p>", "<b></b>")).toBe("<!doctype html><b></b><p>x</p>");
  });

  it("carries no meta policy", () => {
    expect(withPreviewPrologue("<p>x</p>")).not.toContain("Content-Security-Policy");
    expect(withPreviewCsp("<p>x</p>")).toContain("Content-Security-Policy");
  });
});
