import { describe, expect, it } from "vitest";
import { computeAttachmentZoomSize } from "./attachment-thumbnail-zoom-size";

describe("computeAttachmentZoomSize", () => {
  it("shows a square image at six times the thumbnail", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 800, imageHeight: 800 }),
    ).toEqual({ width: 288, height: 288 });
  });

  it("keeps the short side at six times the thumbnail for a wide image", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 1000, imageHeight: 500 }),
    ).toEqual({ width: 576, height: 288 });
  });

  it("caps the long side of a very wide image and scales the short side down", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 2000, imageHeight: 200 }),
    ).toEqual({ width: 864, height: 86 });
  });

  it("caps the long side of a tall image", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 400, imageHeight: 1600 }),
    ).toEqual({ width: 216, height: 864 });
  });

  it("falls back to a square when the image size is unknown", () => {
    expect(computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 0, imageHeight: 0 })).toEqual(
      { width: 288, height: 288 },
    );
  });
});
