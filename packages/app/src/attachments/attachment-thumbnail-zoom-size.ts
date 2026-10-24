export const ATTACHMENT_ZOOM_FACTOR = 3;
// Past this aspect ratio the long side stops growing and the whole zoom shrinks to fit.
const MAX_LONG_SIDE_RATIO = 3;

export interface ZoomSize {
  width: number;
  height: number;
}

/**
 * The thumbnail is a square crop of the image's short side. The zoom shows the whole image with
 * that short side at `ZOOM_FACTOR` times the thumbnail, and the long side capped at
 * `MAX_LONG_SIDE_RATIO` times that, scaling both sides down past the cap.
 */
export function computeAttachmentZoomSize(input: {
  thumbnailSize: number;
  imageWidth: number;
  imageHeight: number;
}): ZoomSize {
  const shortSide = input.thumbnailSize * ATTACHMENT_ZOOM_FACTOR;
  if (input.imageWidth <= 0 || input.imageHeight <= 0) {
    return { width: shortSide, height: shortSide };
  }
  const longSideMax = shortSide * MAX_LONG_SIDE_RATIO;
  const aspect = input.imageWidth / input.imageHeight;
  if (aspect >= 1) {
    const width = Math.min(shortSide * aspect, longSideMax);
    return { width: Math.round(width), height: Math.round(width / aspect) };
  }
  const height = Math.min(shortSide / aspect, longSideMax);
  return { width: Math.round(height * aspect), height: Math.round(height) };
}
