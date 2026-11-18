import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundSchema, defaults, sourceUri, withOpacity } from "../shared/settings";
import { presets } from "../shared/presets";

test("saved settings accept HTTPS images and reject unsafe sources or invalid parameters", () => {
  assert.equal(defaults().enabled, false);
  assert.equal(backgroundSchema.parse({ source: { kind: "url", url: " https://images.example/photo.jpg " } }).source.kind, "url");
  for (const url of ["file:///Users/private/photo.png", "javascript:alert(1)", "http://example.com/a.jpg", "data:image/png;base64,AA=="]) {
    assert.equal(backgroundSchema.safeParse({ source: { kind: "url", url } }).success, false, url);
  }
  for (const input of [{ imageOpacity: -0.1 }, { surfaceOpacity: 1.1 }, { blurRadius: 25 }, { brightness: Infinity }, { fit: "stretch" }, { source: { kind: "preset", id: "removed" } }]) {
    assert.equal(backgroundSchema.safeParse(input).success, false);
  }
});

test("bundled backgrounds are distinct, local SVG assets with no remote dependency", () => {
  assert.equal(new Set(presets.map((p) => p.uri)).size, 6);
  for (const preset of presets) {
    const uri = sourceUri({ ...defaults(), source: { kind: "preset", id: preset.id } });
    assert.ok(uri.startsWith("data:image/svg+xml"));
    const svg = decodeURIComponent(uri.split(",")[1]);
    assert.ok(svg.includes('viewBox="0 0 1920 1200"'));
    assert.ok(!/(?:href=["']|url\()[\s]*https?:|<script|<foreignObject/.test(svg));
  }
});

test("surface blending preserves original alpha and ignores transparent or unknown colors", () => {
  assert.equal(withOpacity("rgba(12, 24, 36, 0.5)", 0.4), "rgba(12, 24, 36, 0.2)");
  assert.equal(withOpacity("rgb(12 24 36 / 0.8)", 0.5), "rgba(12, 24, 36, 0.4)");
  assert.equal(withOpacity("#abc", 0.5), "rgba(170, 187, 204, 0.5)");
  assert.equal(withOpacity("rgba(0, 0, 0, 0)", 1), null);
  assert.equal(withOpacity("transparent", 1), null);
  assert.equal(withOpacity("var(--surface)", 1), null);
});
