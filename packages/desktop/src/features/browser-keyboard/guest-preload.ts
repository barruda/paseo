import { ipcRenderer } from "electron";
import type { BrowserKeyboardPolicy, BrowserShortcutPrefix } from "./policy.js";

const POLICY_CHANNEL = "paseo:browser-keyboard-policy";
const POLICY_REQUEST_CHANNEL = "paseo:browser-keyboard-policy-request";
const SHORTCUT_INPUT_CHANNEL = "paseo:browser-shortcut-input";

let browserId: string | null = null;
let policy: BrowserShortcutPrefix[] = [];

interface BrowserKeyboardPolicyPayload extends BrowserKeyboardPolicy {
  browserId: string;
}

function findPolicyPrefix(event: KeyboardEvent): BrowserShortcutPrefix | undefined {
  const editable = isEditableTarget(event.target);
  return policy.find((prefix) => {
    if (
      prefix.alt !== event.altKey ||
      prefix.control !== event.ctrlKey ||
      prefix.meta !== event.metaKey ||
      prefix.shift !== event.shiftKey ||
      (prefix.editable === false && editable) ||
      (prefix.repeat === false && event.repeat)
    ) {
      return false;
    }
    if (prefix.key === undefined) {
      return matchesCode(prefix.code, event.code);
    }
    const eventKey = event.key.toLowerCase();
    if (eventKey === prefix.key) {
      return true;
    }
    if (prefix.shift && prefix.shiftedKey !== undefined && eventKey === prefix.shiftedKey) {
      return true;
    }
    return (prefix.alt || prefix.codeFallback === true) && matchesCode(prefix.code, event.code);
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function matchesCode(prefixCode: string, eventCode: string): boolean {
  if (prefixCode !== "Digit") {
    return prefixCode === eventCode;
  }
  return /^(?:Digit|Numpad)[1-9]$/.test(eventCode);
}

function sendShortcut(event: KeyboardEvent, shortcutBrowserId: string): void {
  ipcRenderer.send(SHORTCUT_INPUT_CHANNEL, {
    alt: event.altKey,
    browserId: shortcutBrowserId,
    code: event.code,
    control: event.ctrlKey,
    key: event.key,
    meta: event.metaKey,
    repeat: event.repeat,
    shift: event.shiftKey,
  });
}

function stageShortcutForward(event: KeyboardEvent): void {
  if (!event.isTrusted || event.defaultPrevented || !browserId) {
    return;
  }
  const prefix = findPolicyPrefix(event);
  if (!prefix) {
    return;
  }

  const shortcutBrowserId = browserId;
  // CUSTOM(browser-shortcut-preempt): this preload's capture listener runs before the page's.
  if (prefix.preempt) {
    event.preventDefault();
    event.stopImmediatePropagation();
    sendShortcut(event, shortcutBrowserId);
    return;
  }
  window.addEventListener(
    "keydown",
    (completedEvent) => {
      if (completedEvent !== event || completedEvent.defaultPrevented) {
        return;
      }
      completedEvent.preventDefault();
      sendShortcut(completedEvent, shortcutBrowserId);
    },
    { once: true },
  );
}

window.addEventListener("keydown", stageShortcutForward, { capture: true });

ipcRenderer.on(POLICY_CHANNEL, (_event, value: BrowserKeyboardPolicyPayload) => {
  if (!value || typeof value.browserId !== "string" || !Array.isArray(value.prefixes)) {
    return;
  }
  browserId = value.browserId;
  policy = value.prefixes;
});

ipcRenderer.send(POLICY_REQUEST_CHANNEL);
