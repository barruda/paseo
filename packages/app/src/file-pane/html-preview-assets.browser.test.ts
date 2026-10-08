import { afterEach, describe, expect, it } from "vitest";
import { withPreviewCsp } from "@/file-pane/html-preview-csp";
import {
  PREVIEW_ASSET_BRIDGE_SCRIPT,
  parsePreviewAssetRequest,
  respondToPreviewAssetRequest,
} from "@/file-pane/html-preview-assets";

// A 1x1 PNG, so the frame can report the decoded size.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

// Static markup and a script-set src, the two ways a gallery page sets images.
const PAGE = `<!doctype html><body>
<img id="static" src="images/a.png">
<script>
const dynamic = document.createElement("img");
dynamic.id = "dynamic";
document.body.append(dynamic);
dynamic.src = "images/b.png";
const external = document.createElement("img");
external.id = "external";
document.body.append(external);
external.src = "../secret.png";
const report = (img) => {
  img.onload = () => parent.postMessage({ type: "loaded", id: img.id, width: img.naturalWidth, src: img.getAttribute("src") }, "*");
};
document.querySelectorAll("img").forEach(report);
</script></body>`;

const mountedFrames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) frame.remove();
});

describe("preview asset bridge", () => {
  it("loads relative images through the parent and leaves refused ones broken", async () => {
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    const requested: string[] = [];
    const loaded = new Map<string, { width: number; src: string }>();

    const done = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timed out")), 10_000);
      window.addEventListener("message", function receive(event) {
        if (event.source !== frame.contentWindow) return;
        const request = parsePreviewAssetRequest(event.data);
        if (request) {
          requested.push(request.url);
          const allowed = request.url.startsWith("images/");
          respondToPreviewAssetRequest(
            frame.contentWindow as Window,
            request,
            allowed ? { bytes: PNG, mime: "image/png" } : null,
          );
          return;
        }
        if (event.data?.type === "loaded") {
          loaded.set(event.data.id, { width: event.data.width, src: event.data.src });
          if (loaded.has("static") && loaded.has("dynamic")) {
            window.clearTimeout(timeout);
            window.removeEventListener("message", receive);
            resolve();
          }
        }
      });
    });

    frame.srcdoc = withPreviewCsp(PAGE, PREVIEW_ASSET_BRIDGE_SCRIPT);
    document.body.append(frame);
    mountedFrames.push(frame);
    await done;

    expect(requested.sort()).toEqual(["../secret.png", "images/a.png", "images/b.png"]);
    expect(loaded.get("static")?.width).toBe(1);
    expect(loaded.get("dynamic")?.width).toBe(1);
    expect(loaded.get("static")?.src).toMatch(/^blob:/);
    expect(loaded.has("external")).toBe(false);
  });
});
