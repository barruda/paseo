import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createWebRuntime } from "../client/web";
import { defaults } from "../shared/settings";
import { deferred, fixture, settle } from "./dom";

let dom: ReturnType<typeof fixture>;
let handles: ReturnType<typeof createWebRuntime>[];
beforeEach(() => { dom = fixture(); handles = []; });
afterEach(() => { handles.forEach((h) => h.dispose()); dom.close(); });
function runtime(report = (_state: any) => {}) { const h = createWebRuntime(report); handles.push(h); return h; }
const enabled = () => ({ ...defaults(), enabled: true, profileId: "host-a", surfaceOpacity: 0.4 });

test("adapts only layout surfaces, preserves opaque controls, and restores React's latest styles", async () => {
  const states: string[] = [];
  const h = runtime((state) => states.push(state.status));
  h.update(enabled());
  await settle();
  assert.ok(dom.document.querySelector("#paseo-background-layer img"));
  const surface = dom.document.querySelector("section")!;
  assert.ok(surface.hasAttribute("data-paseo-background-surface"));
  assert.equal(dom.window.getComputedStyle(dom.document.getElementById("paseo-background-tint")!).backgroundColor, "rgba(20, 24, 30, 0.4)");
  assert.equal(dom.window.getComputedStyle(dom.document.querySelector("button")!).backgroundColor, "rgb(90, 100, 110)");
  assert.ok(states.includes("active"));
  surface.style.backgroundColor = "rgb(180, 190, 200)";
  dom.document.querySelector("main")!.style.backgroundColor = "rgb(180, 190, 200)";
  await settle();
  assert.equal(dom.window.getComputedStyle(dom.document.getElementById("paseo-background-tint")!).backgroundColor, "rgba(180, 190, 200, 0.4)");
  h.dispose();
  assert.equal(dom.window.getComputedStyle(surface).backgroundColor, "rgb(180, 190, 200)");
  assert.equal(dom.document.querySelector("[data-paseo-background-surface],#paseo-background-layer,#paseo-background-style,[data-paseo-background-root]"), null);
});

test("adapts newly mounted chat regions without scanning for streamed text", async () => {
  let reports = 0;
  runtime(() => reports++).update(enabled());
  await settle();
  const chat = dom.document.createElement("article");
  chat.setAttribute("data-testid", "agent-chat-scroll");
  chat.style.backgroundColor = "rgb(40, 50, 60)";
  dom.document.querySelector("main")!.appendChild(chat);
  await settle();
  assert.ok(chat.hasAttribute("data-paseo-background-surface"));
  const before = reports;
  chat.appendChild(dom.document.createTextNode("streaming reply"));
  const row = dom.document.createElement("span");
  row.textContent = "new streamed row";
  chat.appendChild(row);
  row.className = "streaming-highlight";
  row.style.transform = "translateY(10px)";
  await settle();
  assert.equal(reports, before);
});

test("adapts cached workspaces when their transparent retained wrappers change visibility", async () => {
  const first = dom.document.querySelector("section")!;
  const wrapper = dom.document.createElement("div");
  first.replaceWith(wrapper);
  wrapper.appendChild(first);
  const cached = dom.document.createElement("div");
  cached.style.display = "none";
  cached.innerHTML = '<section data-testid="workspace-pane-cached" style="background-color:rgb(45, 50, 60)"></section>';
  dom.document.querySelector("main")!.appendChild(cached);
  runtime().update(enabled());
  await settle();
  assert.equal(wrapper.hasAttribute("data-paseo-background-surface"), false);
  const second = cached.querySelector("section")!;
  assert.equal(second.hasAttribute("data-paseo-background-surface"), false);
  for (const next of [cached, wrapper, cached, wrapper]) {
    wrapper.style.display = next === wrapper ? "flex" : "none";
    cached.style.display = next === cached ? "flex" : "none";
    await settle();
    assert.ok(next.querySelector("section")!.hasAttribute("data-paseo-background-surface"), "The newly visible workspace must be adapted without a focus or settings event");
    assert.equal(dom.document.querySelectorAll("#paseo-background-layer").length, 1);
  }
});

test("adapts a newly visible cached workspace before the next paint task", async () => {
  const cached = dom.document.createElement("div");
  cached.style.display = "none";
  cached.innerHTML = '<section data-testid="workspace-pane-next" style="background-color:rgb(45,50,60)"></section>';
  dom.document.querySelector("main")!.appendChild(cached);
  runtime().update(enabled());
  await settle();
  cached.style.display = "flex";
  await settle(0);
  assert.ok(cached.querySelector("section")!.hasAttribute("data-paseo-background-surface"), "No timer delay may expose the native workspace background");
});

test("adapts layout size changes without a DOM attribute change", async () => {
  const pane = dom.document.querySelector("section")!;
  let visible = false;
  const rect = pane.getBoundingClientRect.bind(pane);
  pane.getBoundingClientRect = () => visible ? rect() : { ...rect(), width: 0, height: 0 };
  runtime().update(enabled());
  await settle();
  assert.equal(pane.hasAttribute("data-paseo-background-surface"), false);
  visible = true;
  dom.resize(pane);
  await settle(0);
  assert.ok(pane.hasAttribute("data-paseo-background-surface"));
});

test("covers short layout bars, the explorer and composer surroundings while preserving controls", async () => {
  const main = dom.document.querySelector("main")!;
  main.insertAdjacentHTML("beforeend", '<header data-testid="composer-dock-header" style="background-color:rgb(25,28,33)"></header><aside data-testid="workspace-explorer-sidebar" style="background-color:rgb(30,35,42)"><nav data-testid="workspace-tabs-row" style="background-color:rgb(30,35,42)"></nav><div style="background-color:rgb(30,35,42)"><div data-testid="file-explorer-tree-scroll"></div></div></aside><footer style="background-color:rgb(25,28,33)"><div data-testid="message-input-root"><button style="background-color:rgb(90,100,110)">Send</button></div></footer>');
  const rect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const box = rect.call(this);
    if (this.style.display === "contents") return { ...box, width: 0, height: 0 };
    return { ...box, height: ["HEADER", "NAV", "FOOTER"].includes(this.tagName) ? 36 : box.height };
  };
  runtime().update(enabled());
  await settle();
  for (const node of main.querySelectorAll("header,nav,footer,[data-testid=workspace-explorer-sidebar]"))
    assert.ok(node.hasAttribute("data-paseo-background-surface"), `${node.tagName} layout background must be adapted`);
  assert.ok(dom.document.getElementById("paseo-background-tint"), "All regions share one theme tint");
  for (const button of main.querySelectorAll("button")) assert.equal(dom.window.getComputedStyle(button).backgroundColor, "rgb(90, 100, 110)");
  const plugin = dom.document.createElement("div");
  plugin.style.cssText = "overflow-y:auto;background-color:rgb(20,24,30)";
  plugin.innerHTML = '<div class="plugin-card" style="background-color:rgb(60,70,80)">Keep cards distinct</div>';
  const provider = dom.document.createElement("div");
  provider.style.display = "contents";
  provider.appendChild(plugin);
  main.querySelector('[data-testid="workspace-explorer-sidebar"]')!.appendChild(provider);
  await settle(0);
  assert.ok(plugin.hasAttribute("data-paseo-background-surface"), "Unlabelled plugin scroll viewports are layout surfaces too");
  assert.equal(plugin.firstElementChild!.hasAttribute("data-paseo-background-surface"), false, "Panel cards keep their own backgrounds");
  const editor = dom.document.createElement("div");
  editor.className = "monaco-editor";
  editor.style.cssText = "overflow-y:auto;background-color:rgb(60,70,80)";
  plugin.parentElement!.appendChild(editor);
  await settle(0);
  assert.equal(editor.hasAttribute("data-paseo-background-surface"), false, "Embedded editors retain their backgrounds");
});

test("nested workspace and chat regions do not multiply the configured surface opacity", async () => {
  const pane = dom.document.querySelector("section")!;
  const workspace = dom.document.createElement("div");
  workspace.id = "nested-workspace";
  pane.replaceWith(workspace);
  workspace.innerHTML = '<header><span data-testid="workspace-header-title">Workspace</span></header>';
  workspace.appendChild(pane);
  pane.innerHTML = '<article><div data-testid="agent-chat-scroll"></div></article>';
  // Paseo uses stylesheet colors. JSDOM does not implement !important over
  // inline colors, so use the same cascade here for the compositing assertion.
  for (const node of dom.document.querySelectorAll("main, aside, section")) node.removeAttribute("style");
  const theme = dom.document.createElement("style");
  theme.textContent = "main{background-color:rgb(20,24,30)}aside,section,#nested-workspace,article{background-color:rgb(25,28,33)}";
  dom.document.head.appendChild(theme);
  const h = runtime();
  const values = { ...enabled(), surfaceOpacity: 0.72 };
  h.update(values);
  await settle();
  function chatAlpha() {
    const tint = dom.window.getComputedStyle(dom.document.getElementById("paseo-background-tint")!).backgroundColor;
    let transmission = 1 - Number(tint.slice(5, -1).split(",")[3]);
    for (let node = pane.querySelector("[data-testid=agent-chat-scroll]"); node && node.id !== "root"; node = node.parentElement) {
      const color = dom.window.getComputedStyle(node).backgroundColor;
      const alpha = color.startsWith("rgba(") ? Number(color.slice(5, -1).split(",")[3]) : color.startsWith("rgb(") ? 1 : 0;
      transmission *= 1 - alpha;
    }
    return 1 - transmission;
  }
  assert.ok(Math.abs(chatAlpha() - 0.72) < 0.001, "The composed chat background must match the slider rather than stacking several tints");
  h.update({ ...values, surfaceOpacity: 0.4 });
  await settle();
  assert.ok(Math.abs(chatAlpha() - 0.4) < 0.001, "Changing the slider must control the composed opacity");
  // Refreshing an already adapted tree must not accumulate alpha either.
  dom.window.dispatchEvent(new dom.window.Event("focus"));
  await settle();
  assert.ok(Math.abs(chatAlpha() - 0.4) < 0.001);
});

test("late image decode cannot recreate a disabled or disposed background", async () => {
  const loading = deferred<void>();
  dom.decode(() => loading.promise);
  const h = runtime();
  h.update(enabled());
  h.update({ ...enabled(), enabled: false });
  loading.resolve();
  await settle();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
  h.dispose();
  h.update(enabled());
  await settle();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
});

test("a failed replacement retains the loaded image and reports a visible error", async () => {
  let status = "";
  const h = runtime((state) => { status = state.status; });
  h.update(enabled());
  await settle();
  const original = dom.document.querySelector("#paseo-background-layer img");
  dom.decode(() => Promise.reject(new Error("Image decode failed")));
  h.update({ ...enabled(), source: { kind: "url", url: "https://example.com/broken.jpg" } });
  await settle();
  assert.equal(status, "error");
  assert.equal(dom.document.querySelector("#paseo-background-layer img"), original);
  dom.resize(dom.document.querySelector("section")!);
  await settle(0);
  assert.equal(status, "error", "A layout resize must not hide the replacement error");
});

test("a newer selection wins an image loading race", async () => {
  const old = deferred<void>();
  dom.decode((image) => image.src.includes("slow.jpg") ? old.promise : Promise.resolve());
  const h = runtime();
  h.update({ ...enabled(), source: { kind: "url", url: "https://example.com/slow.jpg" } });
  h.update({ ...enabled(), source: { kind: "preset", id: "night" } });
  await settle();
  const selected = dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src");
  old.resolve();
  await settle();
  assert.equal(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), selected);
});

test("multiple hosts share one layer, preview temporarily, and remember the chosen host", async () => {
  const a = runtime();
  const b = runtime();
  a.update(enabled());
  b.update({ ...enabled(), profileId: "host-b", source: { kind: "preset", id: "dunes" } }, false, true);
  await settle();
  const chosen = dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src");
  a.update(enabled(), true);
  await settle();
  assert.notEqual(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), chosen);
  a.update(enabled());
  await settle();
  assert.equal(dom.document.querySelectorAll("#paseo-background-layer").length, 1);
  assert.equal(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), chosen);
  assert.equal(dom.window.localStorage.getItem("paseo-background:selected-profile:v1"), "host-b");
  a.dispose();
  assert.ok(dom.document.getElementById("paseo-background-layer"));
  b.dispose();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
  assert.equal((globalThis as any)[Symbol.for("MinLeeV5.paseo-background.manager.v1")], undefined);
});

test("rebuilds its layer if the app root is remounted", async () => {
  const h = runtime();
  h.update(enabled());
  await settle();
  const old = dom.document.getElementById("root")!;
  const root = dom.document.createElement("div");
  root.id = "root";
  root.innerHTML = '<section data-testid="workspace-pane-next" style="background-color:rgb(21, 22, 23)"></section>';
  old.replaceWith(root);
  dom.window.dispatchEvent(new dom.window.Event("focus"));
  await settle();
  assert.ok(root.querySelector("#paseo-background-layer img"));
  assert.equal(old.querySelector("[data-paseo-background-surface]"), null);
});
