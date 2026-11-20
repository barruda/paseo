import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  dominantColorFromIcon,
  dominantColorFromRgba,
  dominantColorFromSvg,
} from "../server/dominant-color";

function pixels(rows: [number, number, number, number][]): Uint8Array {
  return new Uint8Array(rows.flat());
}

describe("dominantColorFromRgba", () => {
  it("ignores transparent, near-white and near-black pixels", () => {
    const image = pixels([
      [255, 0, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [10, 200, 30, 0],
    ]);
    expect(dominantColorFromRgba(4, 1, image)).toEqual({
      kind: "color",
      color: "#ff0000",
    });
  });

  it("weights saturated pixels above gray ones", () => {
    const image = pixels([
      [255, 0, 0, 255],
      [128, 128, 128, 255],
      [128, 128, 128, 255],
    ]);
    const result = dominantColorFromRgba(3, 1, image);
    expect(result.kind).toBe("color");
    if (result.kind !== "color") return;
    const red = parseInt(result.color.slice(1, 3), 16);
    expect(red).toBeGreaterThan(128);
  });

  it("reports a monochrome icon instead of a gray accent", () => {
    const image = pixels([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [128, 128, 128, 255],
    ]);
    expect(dominantColorFromRgba(3, 1, image)).toEqual({
      kind: "monochrome",
    });
  });

  it("treats a fully transparent icon as monochrome", () => {
    expect(dominantColorFromRgba(1, 1, pixels([[255, 0, 0, 0]]))).toEqual({
      kind: "monochrome",
    });
  });
});

describe("dominantColorFromIcon", () => {
  it("decodes a PNG icon", () => {
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([0, 0, 255, 255, 0, 0, 255, 255]);
    const result = dominantColorFromIcon(PNG.sync.write(png), "image/png");
    expect(result).toEqual({ kind: "color", color: "#0000ff" });
  });

  it("reads an SVG's paint colors", () => {
    const svg = `<svg fill="none">
      <rect width="10" height="10" fill="#ffffff"/>
      <path fill="#e91e63" d="M0 0"/>
      <path style="fill:#e91e63" d="M1 1"/>
    </svg>`;
    const result = dominantColorFromSvg(svg);
    expect(result.kind).toBe("color");
    if (result.kind !== "color") return;
    expect(result.color).toMatch(/^#[a-f0-9]{6}$/);
    expect(result.color).not.toBe("#ffffff");
  });

  it("reads named colors and colors declared in a style block", () => {
    const named = dominantColorFromSvg(
      `<svg><path fill="red"/><path fill="red"/></svg>`,
    );
    expect(named).toEqual({ kind: "color", color: "#ff0000" });
    const styled = dominantColorFromSvg(
      `<svg><style>.cls-1{fill:#e91e63}.cls-2{stroke:blue}</style>` +
        `<path class="cls-1" d="M0 0"/><path class="cls-2" d="M1 1"/></svg>`,
    );
    expect(styled.kind).toBe("color");
    if (styled.kind !== "color") return;
    expect(styled.color).not.toBe("#ffffff");
  });

  it("does not read a gradient id or a transparent paint as a color", () => {
    const svg = `<svg>
      <path fill="url(#abc123)" d="M0 0"/>
      <path fill="rgba(255,0,0,0)" d="M0 0"/>
    </svg>`;
    expect(dominantColorFromSvg(svg)).toEqual({ kind: "monochrome" });
  });

  it("reports a black-and-white SVG as monochrome", () => {
    const svg = `<svg><rect fill="#000000"/><path fill="#ffffff"/></svg>`;
    expect(dominantColorFromSvg(svg)).toEqual({ kind: "monochrome" });
  });

  it("falls back for an icon format it cannot decode", () => {
    expect(
      dominantColorFromIcon(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"),
    ).toEqual({ kind: "unsupported" });
  });
});
