// CUSTOM(workboard-images)
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobToBase64, pastedImages } from "../client/image-paste";
import { ImageStore, defaultImageDirectory } from "../server/images";
import {
  findImageRefs,
  insertImageRefs,
  removeImageRef,
  sniffImageType,
} from "../shared/images";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const saved = "/home/u/.paseo/plugin-data/paseo-workboard/images/a.png";

describe("image references", () => {
  it("finds only images Workboard saved", () => {
    const text = `intro\n![image](${saved})\n![logo](https://example.com/x.png)`;
    expect(findImageRefs(text)).toEqual([
      { path: saved, start: 6, end: 6 + `![image](${saved})`.length },
    ]);
  });

  it("puts pasted images on their own lines at the selection", () => {
    expect(
      insertImageRefs("before after", { start: 7, end: 12 }, [
        "/x/a.png",
        "/x/b.png",
      ]),
    ).toBe("before \n![image](/x/a.png)\n![image](/x/b.png)\n");
    expect(insertImageRefs("", { start: 0, end: 0 }, ["/x/a.png"])).toBe(
      "![image](/x/a.png)\n",
    );
  });

  it("clamps a selection the text has since outgrown", () => {
    expect(insertImageRefs("ab", { start: 9, end: 9 }, ["/x/a.png"])).toBe(
      "ab\n![image](/x/a.png)\n",
    );
  });

  it("removes a reference with the line break it was given", () => {
    const text = insertImageRefs("one\ntwo", { start: 4, end: 4 }, [saved]);
    const [ref] = findImageRefs(text);
    expect(removeImageRef(text, ref!)).toBe("one\ntwo");
  });

  it("recognizes image types from their bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(sniffImageType(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe(
      "image/webp",
    );
    expect(sniffImageType(Buffer.from("<svg/>"))).toBeNull();
  });
});

describe("ImageStore", () => {
  let root: string;
  let directory: string;
  let store: ImageStore;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "workboard-images-"));
    directory = path.join(root, "plugin-data", "paseo-workboard", "images");
    store = new ImageStore(directory);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("lives under PASEO_HOME", () => {
    expect(defaultImageDirectory({ PASEO_HOME: "/srv/paseo" })).toBe(
      "/srv/paseo/plugin-data/paseo-workboard/images",
    );
  });

  it("saves an image and reads it back as a data URI", async () => {
    const { path: file } = await store.save({
      mimeType: "image/png",
      base64: PNG.toString("base64"),
    });
    expect(path.dirname(file)).toBe(directory);
    expect(file.endsWith(".png")).toBe(true);
    expect(await readFile(file)).toEqual(PNG);
    expect(findImageRefs(`![image](${file})`)).toHaveLength(1);
    expect(await store.read({ path: file })).toEqual({
      dataUri: `data:image/png;base64,${PNG.toString("base64")}`,
    });
  });

  it("names the file after the bytes, not the clipboard's label", async () => {
    const { path: file } = await store.save({
      mimeType: "image/jpeg",
      base64: PNG.toString("base64"),
    });
    expect(file.endsWith(".png")).toBe(true);
  });

  it("rejects data that is not a supported image", async () => {
    await expect(
      store.save({
        mimeType: "image/png",
        base64: Buffer.from("<svg/>").toString("base64"),
      }),
    ).rejects.toThrow("not a PNG");
    await expect(
      store.save({ mimeType: "image/svg+xml", base64: PNG.toString("base64") }),
    ).rejects.toThrow("Unsupported image type");
  });

  it("reads nothing outside its directory", async () => {
    await store.save({ mimeType: "image/png", base64: PNG.toString("base64") });
    const outside = path.join(root, "secret.png");
    await writeFile(outside, PNG);
    await expect(store.read({ path: outside })).rejects.toThrow(
      "Not a Workboard image",
    );
    await expect(
      store.read({ path: path.join(directory, "..", "..", "secret.png") }),
    ).rejects.toThrow();
    await expect(
      store.read({ path: path.join(directory, "gone.png") }),
    ).rejects.toThrow("no longer exists");
  });
});

describe("pasted images", () => {
  const item = (kind: string, type: string, file: Blob | null) => ({
    kind,
    type,
    getAsFile: () => file,
  });

  it("takes image files from the clipboard and ignores text", () => {
    const image = new Blob(["png bytes"]);
    const event = {
      clipboardData: {
        items: [
          item("string", "text/plain", null),
          item("file", "image/png", image),
          item("file", "application/pdf", new Blob(["%PDF"])),
        ],
      },
      preventDefault() {},
    };
    expect(pastedImages(event)).toEqual([image]);
    expect(pastedImages({ clipboardData: null, preventDefault() {} })).toEqual(
      [],
    );
  });

  it("encodes a blob as base64", async () => {
    const blob = { arrayBuffer: async () => new Uint8Array(PNG).buffer };
    expect(await blobToBase64(blob)).toBe(PNG.toString("base64"));
  });
});
