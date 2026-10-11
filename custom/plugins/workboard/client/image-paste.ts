// CUSTOM(workboard-images): paste images into a TextInput. Web and desktop only: on web the
// TextInput ref is the DOM textarea, which gets the paste event with the clipboard's files. Native
// TextInput never receives pasted images, so the ref there lacks addEventListener and nothing is
// attached.
import { useCallback, useEffect, useRef } from "react";

export interface PastedImages {
  images: Blob[];
  selection: { start: number; end: number };
}

interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile(): Blob | null;
}

interface PasteEventLike {
  clipboardData: { items: ArrayLike<ClipboardItemLike> } | null;
  preventDefault(): void;
}

interface PasteTarget {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  addEventListener(
    type: "paste",
    listener: (event: PasteEventLike) => void,
  ): void;
  removeEventListener(
    type: "paste",
    listener: (event: PasteEventLike) => void,
  ): void;
}

function isPasteTarget(node: unknown): node is PasteTarget {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as Partial<PasteTarget>).addEventListener === "function" &&
    typeof (node as Partial<PasteTarget>).value === "string"
  );
}

/** The image files on a paste event, in clipboard order. Text-only pastes return none. */
export function pastedImages(event: PasteEventLike): Blob[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const images: Blob[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) images.push(file);
  }
  return images;
}

/**
 * A callback ref for the TextInput. Pasting text behaves as usual; pasting images cancels the
 * default and hands the images and the selection at paste time to `onImages`.
 */
export function useImagePaste(
  onImages: (pasted: PastedImages) => void,
  enabled: boolean,
): (node: unknown) => void {
  const handler = useRef(onImages);
  handler.current = onImages;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const detach = useRef<(() => void) | null>(null);

  useEffect(() => () => detach.current?.(), []);

  return useCallback((node: unknown) => {
    detach.current?.();
    detach.current = null;
    if (!isPasteTarget(node)) return;
    const listener = (event: PasteEventLike) => {
      if (!enabledRef.current) return;
      const images = pastedImages(event);
      if (images.length === 0) return;
      event.preventDefault();
      handler.current({
        images,
        selection: {
          start: node.selectionStart ?? node.value.length,
          end: node.selectionEnd ?? node.value.length,
        },
      });
    };
    node.addEventListener("paste", listener);
    detach.current = () => node.removeEventListener("paste", listener);
  }, []);
}

/** Base64 without the data-URI prefix, encoded in chunks so a large image doesn't overflow the stack. */
export async function blobToBase64(
  blob: Pick<Blob, "arrayBuffer">,
): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
