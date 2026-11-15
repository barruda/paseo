import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastShow, panelProps, passthrough } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: unknown }) => children,
  toastShow: vi.fn(),
  panelProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? factory({ colors: { surface0: "#000" } }) : factory,
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ show: toastShow }) }));
vi.mock("@/composer/editing-session", () => ({
  ComposerEditingScope: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("@/panels/retained-chat-content", () => ({
  RetainedChatContent: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ prepareAgentTimeline: () => Promise.resolve() }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({ sessions: {} }),
}));
vi.mock("@/git/diff-document/workspace-cache", () => ({
  DiffDocumentWorkspaceCacheProvider: passthrough,
}));
vi.mock("@/screens/workspace/sheet-pane", () => ({ SheetPaneHostProvider: passthrough }));
vi.mock("@/screens/workspace/workspace-pane-content", () => ({
  buildWorkspacePaneContentModel: () => ({}),
}));
vi.mock("@/panels/agent-panel", async () => {
  const { usePaneContext, usePaneFocus } = await import("@/panels/pane-context");
  return {
    AgentPanelContent: (props: Record<string, unknown>) => {
      const pane = usePaneContext();
      const focus = usePaneFocus();
      panelProps.current = { ...props, pane, focus };
      return React.createElement("div", { "data-testid": "agent-panel" });
    },
  };
});

import { EmbeddedAgentScreen } from "./embedded-agent-screen";
import { notifyEmbedOpenInApp } from "./embed-notice";

let root: Root | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("EmbeddedAgentScreen", () => {
  it("mounts the agent panel with a main-host stub pane context", () => {
    act(() => {
      root?.render(<EmbeddedAgentScreen serverId="srv" workspaceId="ws" agentId="agent-1" />);
    });

    const props = panelProps.current as {
      serverId: string;
      workspaceId: string;
      agentId: string;
      isPaneFocused: boolean;
      pane: { host: string; tabId: string; target: unknown; openFileInWorkspace: () => void };
      focus: { isInteractive: boolean };
    };
    expect(document.querySelector('[data-testid="agent-panel"]')).not.toBeNull();
    expect(props).toMatchObject({ serverId: "srv", workspaceId: "ws", agentId: "agent-1" });
    expect(props.isPaneFocused).toBe(true);
    expect(props.pane.host).toBe("main");
    expect(props.pane.tabId).toBe("embed:agent-1");
    expect(props.pane.target).toEqual({ kind: "agent", agentId: "agent-1" });
    expect(props.focus.isInteractive).toBe(true);

    props.pane.openFileInWorkspace();
    expect(toastShow).toHaveBeenCalledWith("embed.openInApp", { variant: "info" });
    notifyEmbedOpenInApp();
    expect(toastShow).toHaveBeenCalledTimes(2);
  });
});
