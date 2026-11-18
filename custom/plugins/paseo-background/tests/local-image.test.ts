import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backgroundSchema, defaults, sourceUri } from "../shared/settings";
import { setCachedFile } from "../shared/file-cache";
import { ImageStore } from "../server/images";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

test("settings accept a file source and still accept the old kinds", () => {
  const file = backgroundSchema.parse({ source: { kind: "file", id: "20261117T010203-ab12cd34.jpg", name: "me.jpg" } });
  assert.equal(file.source.kind, "file");
  assert.equal(backgroundSchema.safeParse({ source: { kind: "preset", id: "forest" } }).success, true);
  assert.equal(defaults().source.kind, "preset");
});

test("file ids are validated", () => {
  for (const id of ["", "../x.png", "a/b.png", "a\\b.png", "a b.png", "x".repeat(121)]) {
    assert.equal(backgroundSchema.safeParse({ source: { kind: "file", id, name: "n" } }).success, false, id);
  }
  assert.equal(backgroundSchema.safeParse({ source: { kind: "file", id: "a.png", name: "x".repeat(256) } }).success, false);
});

test("a file source has no uri until its data is cached", () => {
  const values = backgroundSchema.parse({ source: { kind: "file", id: "cached-test.png", name: "n" } });
  assert.equal(sourceUri(values), "");
  setCachedFile("cached-test.png", "data:image/png;base64,AA==");
  assert.equal(sourceUri(values), "data:image/png;base64,AA==");
});

test("image store saves and reads back, and refuses bad input", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bg-images-"));
  try {
    const store = new ImageStore(path.join(dir, "images"));
    const { id } = await store.save({ mimeType: "image/jpeg", base64: PNG.toString("base64"), name: "a.png" });
    assert.match(id, /^\d{8}T\d{6}-[0-9a-f]{8}\.png$/); // extension follows the bytes
    const read = await store.read({ id });
    assert.equal(read.mimeType, "image/png");
    assert.deepEqual(Buffer.from(read.base64, "base64"), PNG);
    for (const bad of ["../images/" + id, "..", "a/b", "/etc/passwd", ".."+id, "missing.png"]) {
      await assert.rejects(store.read({ id: bad }), bad);
    }
    await assert.rejects(store.save({ mimeType: "image/png", base64: Buffer.from("not an image").toString("base64") }), /not a PNG/);
    await assert.rejects(store.save({ mimeType: "text/html", base64: PNG.toString("base64") }), /Unsupported/);
    await assert.rejects(store.save({ mimeType: "image/png", base64: "" }), /empty/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
