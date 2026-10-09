import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { withPreviewCsp } from "@/file-pane/html-preview-csp";
import {
  PREVIEW_KEY_BRIDGE_SCRIPT,
  parsePreviewKey,
  replayPreviewKey,
} from "@/file-pane/html-preview-keys";

// The page claims Ctrl+K for itself; everything else is left to the browser.
const PAGE = `<!doctype html><body>
<input id="field" autofocus>
<script>
addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "k") event.preventDefault();
  if (event.key === "Escape") parent.postMessage({ type: "done" }, "*");
});
addEventListener("load", () => parent.postMessage({ type: "ready" }, "*"));
</script></body>`;

const mountedFrames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) frame.remove();
});

function waitForFrameMessage(frame: HTMLIFrameElement, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Timed out on ${type}`)), 10_000);
    window.addEventListener("message", function receive(event) {
      if (event.source !== frame.contentWindow || event.data?.type !== type) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve();
    });
  });
}

describe("preview key bridge", () => {
  it("replays modifier shortcuts the page leaves alone on the frame element", async () => {
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    frame.style.width = "300px";
    frame.style.height = "200px";
    const replayed: string[] = [];
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow) return;
      const key = parsePreviewKey(event.data);
      if (key) replayPreviewKey(frame, key);
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.target !== frame) return;
        replayed.push(
          `${event.ctrlKey ? "Ctrl+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key}`,
        );
      },
      true,
    );

    const ready = waitForFrameMessage(frame, "ready");
    frame.srcdoc = withPreviewCsp(PAGE, PREVIEW_KEY_BRIDGE_SCRIPT);
    document.body.append(frame);
    mountedFrames.push(frame);
    await ready;

    await userEvent.click(frame);
    const done = waitForFrameMessage(frame, "done");
    await userEvent.keyboard("a{Control>}{Tab}{/Control}{Control>}{Shift>}{Tab}{/Shift}{/Control}");
    await userEvent.keyboard("{Control>}k{/Control}{Escape}");
    await done;
    // Escape travels the same postMessage queue, so every forwarded key has arrived by now.
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(replayed).toEqual(["Ctrl+Tab", "Ctrl+Shift+Tab"]);
  });
});
