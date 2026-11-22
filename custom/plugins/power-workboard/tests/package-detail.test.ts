// CUSTOM(packages): the package modal's sub-tabs, grouped actions and their hints.
import { createElement, type ReactNode } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

vi.mock("@getpaseo/plugin/client/react-native", () => {
  const Modal = ({ children }: { children: ReactNode }) =>
    createElement("Modal", null, children);
  const Content = ({ children }: { children: ReactNode }) =>
    createElement("ModalContent", null, children);
  return { Icon: () => null, Modal: Object.assign(Modal, { Content }) };
});

import { PackageDetail } from "../client/PackageDetail";
import { strings } from "../client/strings";
import type { Board, PackageRun, PackageView } from "../shared/model";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Rendered = TestRenderer.ReactTestRenderer;
type Instance = TestRenderer.ReactTestInstance;

const t = strings("en");
const theme = {
  colors: {
    surface0: "#000000",
    surface1: "#111111",
    surface2: "#222222",
    border: "#333333",
    foreground: "#ffffff",
    foregroundMuted: "#999999",
    accent: "#0055ff",
    accentForeground: "#fafafa",
    statusSuccess: "#00aa00",
    statusWarning: "#aaaa00",
    statusDanger: "#dd0000",
  },
} as PluginSurfaceProps["theme"];

const pkg = (patch: Partial<PackageView> = {}): PackageView => ({
  id: "pkg-1",
  name: "Auth",
  projectId: "p",
  projectName: "Paseo",
  color: "blue",
  status: "open",
  branch: "pkg/auth",
  trigger: { night: true, onClose: true, everyMerges: null },
  tierPolicy: { escalateOnRisk: true },
  gate: {
    command: "npm run typecheck && npm test",
    requiredEnv: [],
    setupCommand: "",
    runIn: "worktree",
  },
  createdAt: "2026-11-20T10:00:00.000Z",
  closedAt: null,
  total: 2,
  merged: 1,
  canceled: 0,
  lastRun: null,
  suspectTaskIds: [],
  ...patch,
});

const board = (title = "Login form") =>
  ({
    cards: [
      { id: "t1", number: 7, title, packageId: "pkg-1", testTier: null },
      { id: "t2", number: 8, title: "Logout", packageId: "pkg-1" },
      { id: "t3", number: 9, title: "Elsewhere", packageId: null },
    ],
    finishes: {
      t1: { mergedAt: "2026-11-21T10:00:00.000Z", mergeTarget: "custom" },
    },
  }) as unknown as Board;

const run: PackageRun = {
  id: "r1",
  packageId: "pkg-1",
  trigger: "manual",
  status: "failed",
  startedAt: "2026-11-21T11:00:00.000Z",
  finishedAt: "2026-11-21T11:01:00.000Z",
  durationMs: 60000,
  commit: null,
  output: "1 test failed",
  suspectTaskId: "t1",
  suspectCommit: null,
};

function props(view: PackageView, data: Board) {
  return {
    pkg: view,
    board: data,
    runs: [run],
    t,
    theme,
    onClose: vi.fn(),
    onRunGate: vi.fn(),
    onAdjust: vi.fn(),
    onClosePackage: vi.fn(),
    onProposeClose: vi.fn(),
  };
}

function render(view = pkg(), data = board()) {
  const all = props(view, data);
  let renderer!: Rendered;
  act(() => {
    renderer = TestRenderer.create(createElement(PackageDetail, all));
  });
  return { renderer, props: all };
}

const byTestId = (renderer: Rendered, id: string): Instance[] =>
  renderer.root.findAll(
    (node) => (node.type as string) === "Pressable" && node.props.testID === id,
  );

function text(renderer: Rendered): string {
  const parts: string[] = [];
  const walk = (node: ReturnType<Rendered["toJSON"]>) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void parts.push(node);
    for (const child of node.children ?? [])
      walk(child as ReturnType<Rendered["toJSON"]>);
  };
  walk(renderer.toJSON());
  return parts.join("");
}

function actionStyle(action: Instance): Record<string, unknown> {
  const style = action.props.style as (state: {
    pressed: boolean;
  }) => unknown[];
  return Object.assign({}, ...style({ pressed: false }).filter(Boolean));
}

function press(node: Instance) {
  act(() => {
    (node.props.onPress as (event: unknown) => void)({ nativeEvent: {} });
  });
}

it("opens on Summary with the four actions, each with its hint", () => {
  const { renderer, props: all } = render();
  const hints = {
    "run-gate": t.packages.hints.runGate,
    adjust: t.packages.hints.adjust,
    "propose-close": t.packages.hints.proposeClose,
    "close-package": t.packages.hints.closePackage,
  };
  for (const [id, hint] of Object.entries(hints)) {
    const [action] = byTestId(renderer, `package-action-${id}`);
    expect(action, id).toBeDefined();
    expect(action!.props.accessibilityHint).toBe(hint);
  }
  expect(t.packages.hints.closePackage).toBe(
    "Closes now and runs the gate. No confirmation.",
  );
  expect(text(renderer)).toContain("1 of 2 merged");
  expect(text(renderer)).toContain("npm run typecheck && npm test");

  press(byTestId(renderer, "package-action-run-gate")[0]!);
  expect(all.onRunGate).toHaveBeenCalledOnce();
  press(byTestId(renderer, "package-action-close-package")[0]!);
  expect(all.onClosePackage).toHaveBeenCalledOnce();
});

it("colors the actions by intent, Close package as destructive", () => {
  const { renderer } = render();
  const style = (id: string) =>
    actionStyle(byTestId(renderer, `package-action-${id}`)[0]!);
  expect(style("run-gate").backgroundColor).toBe(theme.colors.accent);
  expect(style("adjust").borderColor).toBe(theme.colors.border);
  expect(style("propose-close").borderColor).toBe(theme.colors.accent);
  expect(style("close-package").borderColor).toBe(theme.colors.statusDanger);
});

it("hides Propose closing and Close package on a closed package", () => {
  const { renderer } = render(pkg({ status: "closed" }));
  expect(byTestId(renderer, "package-action-run-gate")).toHaveLength(1);
  expect(byTestId(renderer, "package-action-propose-close")).toHaveLength(0);
  expect(byTestId(renderer, "package-action-close-package")).toHaveLength(0);
});

it("switches to Tickets and keeps the tab when the board re-renders", () => {
  const { renderer, props: all } = render();
  expect(text(renderer)).not.toContain("Login form");
  press(byTestId(renderer, "package-tab-tickets")[0]!);
  expect(
    byTestId(renderer, "package-tab-tickets")[0]!.props.accessibilityState,
  ).toEqual({ selected: true });
  expect(text(renderer)).toContain("#7");
  expect(text(renderer)).toContain("Login form");
  expect(text(renderer)).toContain("Logout");
  expect(text(renderer)).not.toContain("Elsewhere");
  expect(byTestId(renderer, "package-action-run-gate")).toHaveLength(0);

  act(() => {
    renderer.update(
      createElement(PackageDetail, {
        ...all,
        pkg: pkg({ merged: 2 }),
        board: board("Login form v2"),
      }),
    );
  });
  expect(text(renderer)).toContain("Login form v2");
  expect(byTestId(renderer, "package-action-run-gate")).toHaveLength(0);
});

it("lists the gate runs with the suspect ticket on Gate history", () => {
  const { renderer } = render();
  press(byTestId(renderer, "package-tab-gate")[0]!);
  const shown = text(renderer);
  expect(shown).toContain("failed");
  expect(shown).toContain("60s");
  expect(shown).toContain("#7 Login form");
  expect(shown).toContain("1 test failed");
});
