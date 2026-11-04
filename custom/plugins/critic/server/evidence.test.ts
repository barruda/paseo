import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectEvidence } from "./evidence";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("collectEvidence", () => {
  let root: string;
  const file = (name: string) => path.join(root, name);

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "critic-evidence-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("attaches linked images, outside the workspace too, and reports what is missing", async () => {
    await writeFile(file("shot.png"), PNG);
    const evidence = await collectEvidence(
      `![a](file://${file("shot.png")}) and [b](${file("gone.png")})`,
      "/somewhere/else",
    );
    expect(evidence.attached).toEqual([file("shot.png")]);
    expect(evidence.images).toEqual([{ data: PNG.toString("base64"), mimeType: "image/png" }]);
    expect(evidence.unavailable).toEqual([{ path: file("gone.png"), reason: "file not found" }]);
  });

  it("resolves a relative link against the agent's workspace", async () => {
    await writeFile(file("shot.png"), PNG);
    const evidence = await collectEvidence("`shot.png`", root);
    expect(evidence.attached).toEqual([file("shot.png")]);
  });

  it("opens a comparison page and attaches the images it shows", async () => {
    await writeFile(file("concept.png"), PNG);
    await writeFile(file("result.png"), PNG);
    await writeFile(file("page.html"), '<img src="concept.png"><img src="result.png" alt="x">');
    const evidence = await collectEvidence(`[compare](${file("page.html")})`, root);
    expect(evidence.attached).toEqual([file("concept.png"), file("result.png")]);
  });

  it("does not report a moved screenshot when the kept copy is attached", async () => {
    await writeFile(file("shot.png"), PNG);
    const evidence = await collectEvidence(
      `![a](/deleted/Temp/shot.png) ![b](${file("shot.png")})`,
      root,
    );
    expect(evidence.attached).toEqual([file("shot.png")]);
    expect(evidence.unavailable).toEqual([]);
  });

  it("keeps the latest images when there are too many", async () => {
    const names = Array.from({ length: 8 }, (_, index) => `s${index}.png`);
    await Promise.all(names.map((name) => writeFile(file(name), PNG)));
    const evidence = await collectEvidence(
      names.map((name) => `![x](${file(name)})`).join(" "),
      root,
    );
    expect(evidence.attached).toEqual(names.slice(2).map(file));
    expect(evidence.unavailable.map((entry) => entry.path)).toEqual(names.slice(0, 2).map(file));
  });

  it("refuses a file that is not really an image", async () => {
    await writeFile(file("fake.png"), "not an image");
    const evidence = await collectEvidence(`![x](${file("fake.png")})`, root);
    expect(evidence.images).toEqual([]);
    expect(evidence.unavailable[0]?.reason).toContain("not a PNG");
  });
});
