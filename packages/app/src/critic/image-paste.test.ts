import { describe, expect, it, vi } from "vitest";
import { listenForPastedImages } from "./image-paste";

function target() {
  const listeners = new Set<(event: never) => void>();
  return {
    addEventListener: (_type: "paste", listener: (event: never) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "paste", listener: (event: never) => void) => {
      listeners.delete(listener);
    },
    paste(items: unknown[]) {
      const event = {
        clipboardData: { items },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      for (const listener of listeners) listener(event as never);
      return event;
    },
  };
}

const imageItem = (file: unknown) => ({
  kind: "file",
  type: "image/png",
  getAsFile: () => file,
});
const textItem = { kind: "string", type: "text/plain" };

describe("listenForPastedImages", () => {
  it("takes a pasted image before anything else sees it", () => {
    const source = target();
    const onFiles = vi.fn();
    listenForPastedImages(source, { canPaste: () => true, onFiles });
    const event = source.paste([imageItem("shot")]);
    expect(onFiles).toHaveBeenCalledWith([{ file: "shot", mimeType: "image/png" }]);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("leaves a text paste for the prompt", () => {
    const source = target();
    const onFiles = vi.fn();
    listenForPastedImages(source, { canPaste: () => true, onFiles });
    const event = source.paste([textItem]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores pastes while it cannot take them and after cleanup", () => {
    const source = target();
    const onFiles = vi.fn();
    let canPaste = false;
    const stop = listenForPastedImages(source, { canPaste: () => canPaste, onFiles });
    source.paste([imageItem("shot")]);
    canPaste = true;
    stop();
    source.paste([imageItem("shot")]);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
