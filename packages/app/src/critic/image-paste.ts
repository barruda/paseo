// CUSTOM(critic): pasting an image into the critic sheet adds it as a reference image.

import {
  type ClipboardDataLike,
  type ClipboardImageFile,
  collectImageFilesFromClipboardData,
} from "@/utils/image-attachments-from-files";

interface PasteTarget {
  addEventListener(type: "paste", listener: (event: PasteEventLike) => void, capture: true): void;
  removeEventListener(
    type: "paste",
    listener: (event: PasteEventLike) => void,
    capture: true,
  ): void;
}

interface PasteEventLike {
  clipboardData?: ClipboardDataLike | null;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Captures pasted images before any input sees them, wherever the focus is. A paste without an
 * image is left alone, so text still pastes into the prompt. Returns the cleanup.
 */
export function listenForPastedImages(
  target: PasteTarget,
  input: {
    canPaste: () => boolean;
    onFiles: (files: ClipboardImageFile[]) => void;
  },
): () => void {
  const handlePaste = (event: PasteEventLike) => {
    if (!input.canPaste()) return;
    const files = collectImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    input.onFiles(files);
  };
  target.addEventListener("paste", handlePaste, true);
  return () => target.removeEventListener("paste", handlePaste, true);
}
