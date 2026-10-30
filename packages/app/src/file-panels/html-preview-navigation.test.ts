import { describe, expect, it } from "vitest";
import {
  htmlPreviewNavigationKind,
  resolvePreviewHtmlLink,
  parsePreviewHtmlLink,
} from "./html-preview-navigation";

describe("htmlPreviewNavigationKind", () => {
  it("allows the WebView's initial document URLs", () => {
    expect(htmlPreviewNavigationKind("about:blank")).toBe("initialDocument");
    expect(htmlPreviewNavigationKind("about:srcdoc")).toBe("initialDocument");
    expect(htmlPreviewNavigationKind("")).toBe("initialDocument");
  });

  it("allows same-document fragment navigation", () => {
    expect(htmlPreviewNavigationKind("about:blank#decision-table")).toBe("fragment");
    expect(htmlPreviewNavigationKind("about:srcdoc#decision-table")).toBe("fragment");
  });

  it("blocks documents that could escape the injected policy", () => {
    expect(htmlPreviewNavigationKind("https://example.com/leak")).toBe("blocked");
    expect(
      htmlPreviewNavigationKind("data:text/html,<script>location='https://example.com'</script>"),
    ).toBe("blocked");
    expect(htmlPreviewNavigationKind("blob:https://example.com/document-id")).toBe("blocked");
  });
});

describe("local HTML preview links", () => {
  it("resolves a report's prototype against the report folder", () => {
    expect(
      resolvePreviewHtmlLink("/reports/diagram-libraries/index.html", "demos/prototype.html"),
    ).toBe("/reports/diagram-libraries/demos/prototype.html");
    expect(resolvePreviewHtmlLink("reports/index.html", "./demo%20one.htm?view=all#diagram")).toBe(
      "reports/demo one.htm",
    );
  });
  it.each([
    "../outside.html",
    "%2e%2e/outside.html",
    "/etc/example.html",
    "https://example.com/a.html",
    "file:///tmp/a.html",
    "//example.com/a.html",
    "a.js",
    "#section",
    "bad%00.html",
  ])("refuses %s", (url) => {
    expect(resolvePreviewHtmlLink("/reports/index.html", url)).toBeNull();
  });
  it("accepts only link messages", () => {
    expect(parsePreviewHtmlLink({ type: "paseo-preview-html-link", url: "demo.html" })).toBe(
      "demo.html",
    );
    expect(parsePreviewHtmlLink({ type: "paseo-preview-html-link", url: 42 })).toBeNull();
    expect(parsePreviewHtmlLink({ type: "other", url: "demo.html" })).toBeNull();
    expect(parsePreviewHtmlLink(null)).toBeNull();
  });
});
