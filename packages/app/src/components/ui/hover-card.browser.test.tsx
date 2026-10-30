import React, { act, useState } from "react";
import { Text } from "react-native";
import { createRoot, type Root } from "react-dom/client";
import { PortalProvider } from "@gorhom/portal";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { RetainedChatContent } from "@/panels/retained-chat-content.web";
import { FloatingPanelPortalHost } from "./floating-panel-portal";
import { HoverCard, HoverCardContent, HoverCardTrigger, useHoverCardClose } from "./hover-card";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Reanimated's web entering animation can't reach react-native-web's style helpers under Vitest
// and throws from the card's `animationstart`; in the app it runs. It is not what these tests test.
function ignoreReanimatedStyleError(event: ErrorEvent) {
  if (String(event.error?.stack ?? "").includes("_updatePropsJS")) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
beforeAll(() => window.addEventListener("error", ignoreReanimatedStyleError, true));
afterAll(() => window.removeEventListener("error", ignoreReanimatedStyleError, true));

let root: Root;
let container: HTMLDivElement;
let setActive: (active: boolean) => void = () => {};
let closeCard: () => void = () => {};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function CloseProbe() {
  closeCard = useHoverCardClose();
  return null;
}

// A chat (retained, frozen once hidden) whose hover card renders in the workspace's portal host,
// outside the chat, as in the app.
function Harness() {
  const [active, set] = useState(true);
  setActive = set;
  return (
    <PortalProvider>
      <RetainedPanelActivity active={active}>
        <RetainedChatContent>
          <HoverCard>
            <CloseProbe />
            <HoverCardTrigger>
              <Text testID="trigger">link</Text>
            </HoverCardTrigger>
            <HoverCardContent placement="top">
              <Text testID="card">card</Text>
            </HoverCardContent>
          </HoverCard>
        </RetainedChatContent>
      </RetainedPanelActivity>
      <FloatingPanelPortalHost />
    </PortalProvider>
  );
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
  }
}

function openCard() {
  const trigger = document.querySelector('[data-testid="trigger"]');
  if (!trigger) throw new Error("trigger did not render");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
}

const card = () => document.querySelector('[data-testid="card"]');

// CUSTOM(chat-file-actions): "Abrir em aba" hides the chat behind the new tab; the card must not
// stay over it.
it("removes an open card when its chat is hidden", async () => {
  act(() => root.render(<Harness />));
  openCard();
  await settle();
  expect(card()).not.toBeNull();

  act(() => setActive(false));
  await settle();

  expect(card()).toBeNull();
});

it("removes the card when an action closes it and hides the chat at once", async () => {
  act(() => root.render(<Harness />));
  openCard();
  await settle();
  expect(card()).not.toBeNull();

  act(() => {
    closeCard();
    setActive(false);
  });
  await settle();

  expect(card()).toBeNull();
});

it("does not bring the card back with the chat", async () => {
  act(() => root.render(<Harness />));
  openCard();
  await settle();
  act(() => setActive(false));
  await settle();

  act(() => setActive(true));
  await settle();

  expect(card()).toBeNull();
});
