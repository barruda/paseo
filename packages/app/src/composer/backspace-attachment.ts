// CUSTOM(backspace-image): Backspace in an empty composer removes the last attached image, like
// deleting a chip in a tag input. Typed text always wins: with any text in the box, Backspace
// edits the text.
import type { ComposerAttachment } from "@/attachments/types";

/** The index of the image Backspace should remove, or null to let the key edit the text. */
export function imageIndexToRemoveOnBackspace(input: {
  key: string;
  hasModifier: boolean;
  text: string;
  attachments: readonly ComposerAttachment[];
}): number | null {
  if (input.key !== "Backspace" || input.hasModifier || input.text.length > 0) return null;
  for (let index = input.attachments.length - 1; index >= 0; index -= 1) {
    if (input.attachments[index].kind === "image") return index;
  }
  return null;
}
