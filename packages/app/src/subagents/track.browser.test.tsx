import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/screens/workspace/sheet-pane", () => ({
  useSheetPanePage: () => () => ({ id: "page", fill: true, content: null }),
}));
vi.mock("@/panels/agent-facts-line", () => ({ useAgentFactsLine: () => null }));
vi.mock("@/components/provider-icons", () => ({ useProviderIcon: () => () => null }));
vi.mock("@/screens/workspace/workspace-tab-presentation", () => ({
  WorkspaceTabIcon: () => null,
}));
vi.mock("@/panels/panel-manifest", () => ({
  getPanelManifest: () => ({ showCloseButton: true }),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("@/components/ui/pane-content-toolbar", () => ({
  ToolbarButton: ({ children }: { children?: React.ReactNode }) => children ?? null,
  paneContentToolbarIconSize: () => 16,
}));

import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { SubagentsTrack } from "./track";
import type { SubagentRow } from "./select";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const SERVER_ID = "server-1";
const NO_SHEET = () => null;
const NOOP = () => undefined;

const PASEO_ROW: SubagentRow = {
  kind: "paseo",
  address: { serverId: SERVER_ID, agentId: "child-agent" },
  id: "child-agent",
  provider: "claude",
  title: "Paseo child",
  description: null,
  subtitle: null,
  status: "running",
  turn: { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null },
  requiresAttention: false,
  createdAt: new Date("2026-11-20T10:00:00.000Z"),
};

const PROVIDER_ROW: SubagentRow = {
  kind: "provider",
  id: "provider-child",
  parentAgentId: "parent-agent",
  provider: "opencode",
  title: "general",
  description: "Review Needs you wake diff",
  subtitle: "general · deepseek/DeepSeek-V4.1-Flash-1017 · High · 150.4k tokens",
  status: "running",
  requiresAttention: false,
  createdAt: new Date("2026-11-20T10:00:01.000Z"),
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function pill(): HTMLElement {
  const trigger = document.querySelector('[data-testid="subagents-track-header"]');
  if (!(trigger instanceof HTMLElement)) throw new Error("subagents pill did not render");
  return trigger;
}

function panelIsOpen(): boolean {
  return pill().getAttribute("aria-expanded") === "true";
}

function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

function mount(
  onOpenSubagent: (address: AgentAddress) => void,
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void,
) {
  act(() =>
    root.render(
      <SubagentsTrack
        serverId={SERVER_ID}
        rows={[PASEO_ROW, PROVIDER_ROW]}
        onOpenSubagent={onOpenSubagent}
        onOpenProviderSubagent={onOpenProviderSubagent}
        sheetTabFor={NO_SHEET}
        onArchiveSubagent={NOOP}
      />,
    ),
  );
}

describe("subagents track rows", () => {
  it("opens and focuses a provider subagent's tab, and closes the panel", () => {
    const onOpenSubagent = vi.fn();
    const onOpenProviderSubagent = vi.fn();
    mount(onOpenSubagent, onOpenProviderSubagent);

    click(pill());
    expect(panelIsOpen()).toBe(true);

    const row = document.querySelector('[data-testid="subagents-track-row-provider-child"]');
    expect(row).not.toBeNull();
    click(row as Element);

    expect(onOpenProviderSubagent).toHaveBeenCalledWith("parent-agent", "provider-child");
    expect(onOpenSubagent).not.toHaveBeenCalled();
    expect(panelIsOpen()).toBe(false);
  });

  it("opens and focuses a Paseo subagent's agent tab, and closes the panel", () => {
    const onOpenSubagent = vi.fn();
    const onOpenProviderSubagent = vi.fn();
    mount(onOpenSubagent, onOpenProviderSubagent);

    click(pill());
    const row = document.querySelector('[data-testid="subagents-track-row-child-agent"]');
    expect(row).not.toBeNull();
    click(row as Element);

    expect(onOpenSubagent).toHaveBeenCalledWith({
      serverId: SERVER_ID,
      agentId: "child-agent",
    });
    expect(onOpenProviderSubagent).not.toHaveBeenCalled();
    expect(panelIsOpen()).toBe(false);
  });
});
