import { JSDOM } from "jsdom";

export function fixture() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"><main style="background-color:rgb(20, 24, 30)"><aside style="background-color:rgb(30, 35, 42)"><div data-testid="sidebar-project-workspace-list-scroll"></div></aside><section data-testid="workspace-pane-test" style="background-color:rgb(25, 28, 33)"><button style="background-color:rgb(90, 100, 110)">Keep controls opaque</button></section></main></div></body></html>`, { url: "https://paseo.test", pretendToBeVisual: true });
  const w = dom.window;
  const sizes = new Set<{ targets: Set<Element>; callback(): void }>();
  class TestResizeObserver {
    targets = new Set<Element>();
    constructor(public callback: () => void) { sizes.add(this); }
    observe(node: Element) { this.targets.add(node); }
    unobserve(node: Element) { this.targets.delete(node); }
    disconnect() { sizes.delete(this); this.targets.clear(); }
  }
  Object.assign(globalThis, { window: w, document: w.document, MutationObserver: w.MutationObserver, ResizeObserver: TestResizeObserver, getComputedStyle: w.getComputedStyle.bind(w) });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    for (let node: HTMLElement | null = this; node; node = node.parentElement) {
      if (w.getComputedStyle(node).display === "none") return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} };
    }
    return { x: 0, y: 0, width: this.tagName === "BUTTON" ? 100 : 640, height: this.tagName === "BUTTON" ? 30 : 400, top: 0, left: 0, right: 640, bottom: 400, toJSON() {} };
  };
  let decode = (_image: HTMLImageElement) => Promise.resolve();
  w.HTMLImageElement.prototype.decode = function () { return decode(this); };
  return { window: w, document: w.document, decode(fn: typeof decode) { decode = fn; }, resize(node: Element) { for (const observer of sizes) if (observer.targets.has(node)) observer.callback(); }, close() { dom.window.close(); } };
}

export const settle = (ms = 160) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
