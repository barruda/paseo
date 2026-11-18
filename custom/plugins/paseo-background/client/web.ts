import type { BackgroundSettings } from "../shared/settings";
import { sourceUri, withOpacity } from "../shared/settings";

// Narrow browser contracts keep the plugin's shared/React Native typecheck free
// of the DOM library. This module is entered only after Platform.OS === "web".
interface Style {
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
}
interface Element {
  nodeType: number;
  id: string;
  tagName: string;
  style: Style;
  textContent: string | null;
  parentElement: Element | null;
  children: Iterable<Element>;
  isConnected: boolean;
  src: string;
  value: string;
  type: string;
  min: string;
  max: string;
  step: string;
  disabled: boolean;
  decode(): Promise<void>;
  matches(selector: string): boolean;
  closest(selector: string): Element | null;
  contains(node: Element): boolean;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Iterable<Element>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  appendChild(node: Element): void;
  prepend(node: Element): void;
  remove(): void;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
  files: ArrayLike<PickedFile> | null;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  getContext(kind: "2d"): { drawImage(image: Element, x: number, y: number, width: number, height: number): void } | null;
  toDataURL(type: string, quality?: number): string;
  accept: string;
  click(): void;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
}
export interface PickedFile { name: string; size: number; type: string }
interface RecordChange {
  type: string;
  target: Element;
  addedNodes: Iterable<Element>;
  removedNodes: Iterable<Element>;
}
declare const document: {
  head: Element;
  documentElement: Element;
  visibilityState: string;
  getElementById(id: string): Element | null;
  createElement(tag: string): Element;
  body: Element;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Iterable<Element>;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
};
declare const window: {
  navigator: { language: string };
  crypto: { randomUUID(): string };
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
};
declare class FileReader {
  result: string | null;
  error: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL(file: PickedFile): void;
}
declare const getComputedStyle: (element: Element) => { backgroundColor: string; overflowY: string; display: string };
declare const queueMicrotask: (callback: () => void) => void;
declare const MutationObserver: new (callback: (records: RecordChange[]) => void) => {
  observe(node: Element, options: object): void;
  disconnect(): void;
};
declare const ResizeObserver: new (callback: () => void) => {
  observe(node: Element): void;
  unobserve(node: Element): void;
  disconnect(): void;
};

export interface RuntimeState {
  status: "off" | "loading" | "active" | "partial" | "error" | "other-host";
  surfaces: number;
  error: string | null;
}
type Owner = { values: BackgroundSettings; report(state: RuntimeState): void; preview: boolean };
const MARK = "data-paseo-background-surface";
const OWNED = "data-paseo-background-owned";
const ROOT_MARK = "data-paseo-background-root";
const STORAGE = "paseo-background:selected-profile:v1";
const ANCHORS = [
  '[data-testid="sidebar-project-workspace-list-scroll"]',
  '[data-testid="sidebar-footer"]',
  '[data-testid="workspace-explorer-sidebar"]',
  '[data-testid="workspace-tabs-row"]',
  '[data-testid="files-pane-header"]',
  '[data-testid="file-explorer-tree-scroll"]',
  '[data-testid="files-empty-area"]',
  '[data-testid="changes-tree-panel"]',
  '[data-testid="changes-repository-header"]',
  '[data-testid="changes-header"]',
  '[data-testid^="workspace-pane-"]',
  '[data-testid="workspace-header-title"]',
  '[data-testid="composer-dock-header"]',
  '[data-testid="paseo-background-settings"]',
  '[data-testid="agent-chat-scroll"]',
  '[data-testid="message-input-root"]',
  '[data-testid="agent-loading"]',
  '[data-testid="agent-load-error"]',
  '[data-testid="agent-not-found"]',
].join(",");
const EXPLORER = '[data-testid="workspace-explorer-sidebar"]';
const CONTENT_SURFACES = '.monaco-editor,.cm-editor,.xterm,iframe,canvas,pre,[role="textbox"],[contenteditable="true"]';

class BackgroundManager {
  private owners = new Map<symbol, Owner>();
  private patched = new Map<Element, string | null>();
  private layoutNodes = new Set<Element>();
  private scrollRoots = new Set<Element>();
  private sizedNodes = new Set<Element>();
  private root: Element | null = null;
  private style: Element | null = null;
  private layer: Element | null = null;
  private image: Element | null = null;
  private tint: Element | null = null;
  private uri = "";
  private loadingUri = "";
  private generation = 0;
  private refreshQueued = false;
  private refreshEpoch = 0;
  private loadTimer: number | null = null;
  private observer: InstanceType<typeof MutationObserver> | null = null;
  private resizeObserver: InstanceType<typeof ResizeObserver> | null = null;
  private active: symbol | null = null;
  private preferred: string | null = null;
  private lastState: RuntimeState = { status: "off", surfaces: 0, error: null };

  constructor() {
    try { this.preferred = window.localStorage.getItem(STORAGE); } catch { /* Storage can be disabled. */ }
  }

  update(token: symbol, owner: Owner, claim = false) {
    this.owners.set(token, owner);
    if (claim && owner.values.profileId) {
      this.preferred = owner.values.profileId;
      try { window.localStorage.setItem(STORAGE, this.preferred); } catch { /* Session selection still works. */ }
    }
    this.render();
  }

  remove(token: symbol) {
    this.owners.delete(token);
    this.render();
  }

  get empty() { return this.owners.size === 0; }

  private cancelLoad() {
    ++this.generation;
    if (this.loadTimer !== null) window.clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.loadingUri = "";
  }

  private report(state: RuntimeState) {
    this.lastState = state;
    for (const [token, owner] of this.owners) {
      owner.report(token === this.active ? state : {
        status: owner.values.enabled && this.active ? "other-host" : "off", surfaces: 0, error: null,
      });
    }
  }

  private render() {
    const candidates = [...this.owners].filter(([, owner]) => owner.values.enabled && owner.values.imageOpacity > 0);
    const preview = candidates.filter(([, owner]) => owner.preview).at(-1);
    const selected = preview ?? candidates.find(([, owner]) => owner.values.profileId === this.preferred)
      ?? (!this.preferred ? candidates.sort((a, b) => a[1].values.profileId.localeCompare(b[1].values.profileId))[0] : undefined);
    this.active = selected?.[0] ?? null;
    if (!selected) {
      this.clear();
      this.report({ status: "off", surfaces: 0, error: null });
      return;
    }
    const values = selected[1].values;
    const uri = sourceUri(values);
    if (!uri) {
      // CUSTOM(background-local-image): a local image still loading from the host.
      this.report({ status: "loading", surfaces: this.patched.size, error: null });
      return;
    }
    if (this.uri === uri && this.image) {
      this.cancelLoad();
      this.ensureLayer();
      this.paint(values);
      this.schedule();
      this.report(this.lastState);
      return;
    }
    if (this.loadingUri === uri) return;
    this.cancelLoad();
    const generation = this.generation;
    this.loadingUri = uri;
    this.report({ status: "loading", surfaces: this.patched.size, error: null });
    const image = document.createElement("img");
    image.setAttribute("alt", "");
    image.setAttribute("aria-hidden", "true");
    image.setAttribute(OWNED, "image");
    image.src = uri;
    this.loadTimer = window.setTimeout(() => {
      if (generation !== this.generation || !this.loadingUri) return;
      this.cancelLoad();
      this.report({ status: "error", surfaces: this.patched.size, error: "Image loading timed out. Check the URL and try again." });
    }, 20000);
    void image.decode().then(() => {
      if (generation !== this.generation || !this.active) return;
      this.ensureLayer();
      if (!this.layer) throw new Error("Paseo's app root was not found.");
      this.image?.remove();
      this.image = image;
      this.layer.appendChild(image);
      this.uri = uri;
      this.loadingUri = "";
      const current = this.owners.get(this.active);
      if (current) this.paint(current.values);
      this.refresh();
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      this.loadingUri = "";
      this.report({ status: "error", surfaces: this.patched.size, error: error instanceof Error ? error.message : "The image could not be loaded." });
    }).finally(() => {
      if (generation === this.generation && this.loadTimer !== null) {
        window.clearTimeout(this.loadTimer);
        this.loadTimer = null;
      }
    });
  }

  private ensureLayer() {
    const root = document.getElementById("root");
    if (!root) return;
    if (this.root === root && this.layer?.isConnected && this.style?.isConnected && this.tint?.isConnected) return;
    this.detach();
    this.root = root;
    root.setAttribute(ROOT_MARK, "true");
    this.layer = document.createElement("div");
    this.layer.id = "paseo-background-layer";
    this.layer.setAttribute(OWNED, "layer");
    this.layer.setAttribute("aria-hidden", "true");
    root.prepend(this.layer);
    if (this.image) this.layer.appendChild(this.image);
    this.tint = document.createElement("div");
    this.tint.id = "paseo-background-tint";
    this.tint.setAttribute(OWNED, "tint");
    this.tint.setAttribute("aria-hidden", "true");
    this.layer.appendChild(this.tint);
    this.style = document.createElement("style");
    this.style.id = "paseo-background-style";
    this.style.setAttribute(OWNED, "style");
    document.head.appendChild(this.style);
    this.observer = new MutationObserver((records) => {
      const changed = records.some((record) => {
        if (record.target.closest(`[${OWNED}]`)) return false;
        // Retained workspaces change visibility on transparent wrappers. Those
        // nodes need observation even though their backgrounds are not patched.
        if (record.type === "attributes") return this.layoutNodes.has(record.target) || record.target.matches(ANCHORS);
        // A plugin panel can mount an unlabelled scroll viewport. Only inspect
        // mounts outside known viewports; rows inside them do not need rescans.
        if (record.target.closest(EXPLORER) && ![...this.scrollRoots].some((root) => root.contains(record.target)) &&
          [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 && !node.getAttribute(OWNED))) return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 &&
          !node.getAttribute(OWNED) && (node.matches(ANCHORS) || Boolean(node.querySelector(ANCHORS))));
      });
      if (changed) this.schedule();
    });
    this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-testid"] });
    this.resizeObserver = new ResizeObserver(this.schedule);
    window.addEventListener("resize", this.schedule);
    window.addEventListener("focus", this.schedule);
  }

  private paint(values: BackgroundSettings) {
    if (!this.image || !this.layer) return;
    const pad = values.blurRadius * 3;
    const rules: Record<string, string> = {
      position: "absolute", inset: `${-pad}px`, width: `calc(100% + ${pad * 2}px)`, height: `calc(100% + ${pad * 2}px)`,
      "object-fit": values.fit, "object-position": values.position,
      opacity: String(values.imageOpacity), filter: `blur(${values.blurRadius}px) brightness(${values.brightness})`,
      "pointer-events": "none", "user-select": "none", "z-index": "0",
    };
    for (const [key, value] of Object.entries(rules)) this.image.style.setProperty(key, value);
  }

  private schedule = () => {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    const epoch = this.refreshEpoch;
    // MutationObserver already batches a React commit. Finish adaptation in
    // its microtask checkpoint, before the browser can paint native surfaces.
    queueMicrotask(() => {
      if (epoch !== this.refreshEpoch) return;
      this.refreshQueued = false;
      this.refresh();
    });
  };

  private anchors() {
    const anchors = new Set(document.querySelectorAll(ANCHORS));
    for (const root of this.scrollRoots) {
      if (!root.isConnected || !root.closest(EXPLORER) || root.closest(CONTENT_SURFACES)) this.scrollRoots.delete(root);
      else anchors.add(root);
    }
    const visit = (node: Element, depth: number) => {
      if (depth > 8 || node.matches(CONTENT_SURFACES) || node.tagName === "BUTTON" || node.getAttribute("role") === "button") return;
      const style = getComputedStyle(node);
      if (style.display === "contents") {
        for (const child of node.children) visit(child, depth);
        return;
      }
      const box = node.getBoundingClientRect();
      // Hidden retained panels still need their viewport paths registered so
      // activation is observed before their first visible frame.
      if (box.width > 0 && box.height > 0 && (box.width < 140 || box.height < 140)) return;
      if (["auto", "scroll"].includes(style.overflowY)) {
        this.scrollRoots.add(node);
        anchors.add(node);
        return;
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    for (const dock of document.querySelectorAll(EXPLORER)) visit(dock, 0);
    return anchors;
  }

  private refresh() {
    if (!this.active || !this.image) return;
    this.ensureLayer();
    if (!this.root?.isConnected || !this.style || !this.tint) {
      this.report({ status: "partial", surfaces: 0, error: "Paseo's app root was not found." });
      return;
    }
    const owner = this.owners.get(this.active);
    if (!owner) return;
    this.layoutNodes.clear();
    this.layoutNodes.add(this.root);
    const surfaces = new Set<Element>();
    let themeColor: string | null = null;
    let fallbackColor: string | null = null;
    // Read the host's current colors without removing stable surface marks or
    // disturbing layout. Measurement and restoration complete in one task.
    this.root.setAttribute(ROOT_MARK, "measure");
    try {
      const shell = this.root.querySelector('[data-testid="wide-shell"]') ?? this.root;
      const shellColor = getComputedStyle(shell).backgroundColor;
      if (withOpacity(shellColor, 1)) themeColor = shellColor;
      const anchors = this.anchors();
      for (const node of this.sizedNodes) {
        if (anchors.has(node)) continue;
        this.resizeObserver?.unobserve(node);
        this.sizedNodes.delete(node);
      }
      for (const node of anchors) {
        if (!this.root.contains(node) || this.sizedNodes.has(node)) continue;
        this.sizedNodes.add(node);
        this.resizeObserver?.observe(node);
      }
      for (const anchor of anchors) {
        if (!this.root.contains(anchor) || anchor.closest(`[${OWNED}]`)) continue;
        const box = anchor.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0;
        for (let node: Element | null = anchor; node && node !== this.root; node = node.parentElement) {
          this.layoutNodes.add(node);
          const bounds = node.getBoundingClientRect();
          // Trusted layout paths include 36px bars. Keep cached surfaces ready
          // while hidden, but leave borders and interactive controls alone.
          if (visible ? bounds.width < 140 || bounds.height <= 1 : !this.patched.has(node)) continue;
          if (["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) || node.getAttribute("role") === "button") continue;
          const color = getComputedStyle(node).backgroundColor;
          if (!withOpacity(color, 1)) continue;
          surfaces.add(node);
          if (visible) fallbackColor = color;
        }
      }
      for (const [node, previous] of this.patched) {
        if (surfaces.has(node)) continue;
        if (previous === null) node.removeAttribute(MARK);
        else node.setAttribute(MARK, previous);
        this.patched.delete(node);
      }
      for (const node of surfaces) {
        if (!this.patched.has(node)) this.patched.set(node, node.getAttribute(MARK));
        if (node.getAttribute(MARK) !== "true") node.setAttribute(MARK, "true");
      }
      this.tint.style.setProperty("background-color", withOpacity(themeColor ?? fallbackColor ?? "rgb(0, 0, 0)", owner.values.surfaceOpacity)!);
    } finally {
      this.root.setAttribute(ROOT_MARK, "true");
    }
    const css = [
      `[${ROOT_MARK}]{position:relative!important;isolation:isolate!important}`,
      `[${ROOT_MARK}]> :not([${OWNED}]){position:relative;z-index:1}`,
      `#paseo-background-layer{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0;contain:strict}`,
      `#paseo-background-tint{position:absolute;inset:0;pointer-events:none;z-index:1}`,
      `[${ROOT_MARK}="true"] [${MARK}]{background-color:transparent!important}`,
    ];
    const text = css.join("\n");
    if (this.style.textContent !== text) this.style.textContent = text;
    // Layout notifications must not clear a loading/error indicator for a
    // replacement image while the previously decoded image remains visible.
    if (this.loadingUri) {
      this.report({ status: "loading", surfaces: surfaces.size, error: null });
      return;
    }
    if (this.lastState.status === "error" && sourceUri(owner.values) !== this.uri) {
      this.report({ ...this.lastState, surfaces: surfaces.size });
      return;
    }
    this.report({ status: surfaces.size > 1 ? "active" : "partial", surfaces: surfaces.size,
      error: surfaces.size > 1 ? null : "This page has no supported background regions yet." });
  }

  private detach() {
    ++this.refreshEpoch;
    this.refreshQueued = false;
    this.observer?.disconnect();
    this.observer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sizedNodes.clear();
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener("focus", this.schedule);
    for (const [node, previous] of this.patched) {
      if (previous === null) node.removeAttribute(MARK);
      else node.setAttribute(MARK, previous);
    }
    this.patched.clear();
    this.layoutNodes.clear();
    this.scrollRoots.clear();
    this.root?.removeAttribute(ROOT_MARK);
    this.layer?.remove();
    this.style?.remove();
    this.layer = null;
    this.tint = null;
    this.style = null;
    this.root = null;
  }

  private clear() {
    this.cancelLoad();
    this.uri = "";
    this.image = null;
    this.detach();
  }
}

const sharedKey = Symbol.for("MinLeeV5.paseo-background.manager.v1");
function manager(): BackgroundManager {
  const scope = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;
  return scope[sharedKey] ?? (scope[sharedKey] = new BackgroundManager());
}

export function createWebRuntime(report: (state: RuntimeState) => void) {
  const token = Symbol("background-installation");
  const shared = manager();
  let disposed = false;
  return {
    update(values: BackgroundSettings, preview = false, claim = false) { if (!disposed) shared.update(token, { values, report, preview }, claim); },
    dispose() {
      if (disposed) return;
      disposed = true;
      shared.remove(token);
      const scope = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;
      if (shared.empty && scope[sharedKey] === shared) delete scope[sharedKey];
    },
  };
}

export function language(): "en" | "zh" { return window.navigator.language.startsWith("zh") ? "zh" : "en"; }
export function profileId() { return window.crypto.randomUUID(); }
export function isVisible() { return document.visibilityState !== "hidden"; }
export function after(callback: () => void, milliseconds: number) {
  const id = window.setTimeout(callback, milliseconds);
  return () => window.clearTimeout(id);
}
export function onWake(callback: () => void) {
  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", callback);
  return () => { window.removeEventListener("focus", callback); document.removeEventListener("visibilitychange", callback); };
}

export function mountRange(node: unknown, options: {
  id: string; label: string; value: number; min: number; max: number; step: number; accent: string;
  onChange(value: number): void;
}) {
  const parent = node as Element | null;
  if (!parent?.appendChild) return { update(_value: number) {}, dispose() {} };
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  input.setAttribute("aria-label", options.label);
  input.setAttribute("data-testid", `background-range-${options.id}`);
  input.setAttribute(OWNED, "range");
  input.style.setProperty("width", "100%");
  input.style.setProperty("height", "28px");
  input.style.setProperty("margin", "0");
  input.style.setProperty("accent-color", options.accent);
  input.style.setProperty("cursor", "pointer");
  const change = () => options.onChange(Number(input.value));
  input.addEventListener("input", change);
  parent.appendChild(input);
  return {
    update(value: number) { input.value = String(value); },
    dispose() { input.removeEventListener("input", change); input.remove(); },
  };
}

export function previewFilter(node: unknown, values: BackgroundSettings) {
  const element = node as Element | null;
  element?.style?.setProperty("filter", `blur(${values.blurRadius}px) brightness(${values.brightness})`);
}

// CUSTOM(background-local-image): ask for an image file, shrink it when large, return base64.
const MAX_SIDE = 2560;
const SHRINK_ABOVE_BYTES = 4 * 1024 * 1024;
export interface PickedImage { name: string; mimeType: string; base64: string; dataUrl: string }

function readDataUrl(file: PickedFile): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

async function shrink(file: PickedFile, dataUrl: string): Promise<string> {
  const image = document.createElement("img");
  image.src = dataUrl;
  await image.decode();
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  // Small GIFs stay as they are so animation survives.
  if (file.type === "image/gif" && file.size <= SHRINK_ABOVE_BYTES) return dataUrl;
  if (longest <= MAX_SIDE && file.size <= SHRINK_ABOVE_BYTES) return dataUrl;
  const scale = Math.min(1, MAX_SIDE / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Resolves null when the user closes the dialog without choosing. */
export function pickImage(): Promise<PickedImage | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp";
    input.style.setProperty("display", "none");
    document.body.appendChild(input);
    const done = (action: () => void) => { input.remove(); action(); };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { done(() => resolve(null)); return; }
      void (async () => {
        const original = await readDataUrl(file);
        const dataUrl = await shrink(file, original);
        const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
        if (!match) throw new Error("The file is not a supported image.");
        return { name: file.name.slice(0, 255), mimeType: match[1]!, base64: match[2]!, dataUrl };
      })().then((picked) => done(() => resolve(picked)), (error: unknown) => done(() => reject(error)));
    });
    input.addEventListener("cancel", () => done(() => resolve(null)));
    input.click();
  });
}
