import { describe, expect, it } from "vitest";
import { computeAttachmentZoomSize } from "./attachment-thumbnail-zoom-size";

describe("computeAttachmentZoomSize", () => {
  it("shows a square image at three times the thumbnail", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 800, imageHeight: 800 }),
    ).toEqual({ width: 144, height: 144 });
  });

  it("keeps the short side at three times the thumbnail for a wide image", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 1000, imageHeight: 500 }),
    ).toEqual({ width: 288, height: 144 });
  });

  it("caps the long side of a very wide image and scales the short side down", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 2000, imageHeight: 200 }),
    ).toEqual({ width: 432, height: 43 });
  });

  it("caps the long side of a tall image", () => {
    expect(
      computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 400, imageHeight: 1600 }),
    ).toEqual({ width: 108, height: 432 });
  });

  it("falls back to a square when the image size is unknown", () => {
    expect(computeAttachmentZoomSize({ thumbnailSize: 48, imageWidth: 0, imageHeight: 0 })).toEqual(
      { width: 144, height: 144 },
    );
  });
});
