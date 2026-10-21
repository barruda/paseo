/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/utils/projects";

const { confirmDialog, removeProject, toastError, supportsProjectRemove } = vi.hoisted(() => ({
  confirmDialog: vi.fn<() => Promise<boolean>>(),
  removeProject: vi.fn(async () => ({ removedWorkspaceIds: [] })),
  toastError: vi.fn(),
  supportsProjectRemove: { current: true },
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("span", null, children),
  };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onPress },
      children,
    ),
}));

vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("section", null, children),
}));

vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: toastError }) }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient: () => ({ removeProject }) }),
}));
vi.mock("@/stores/session-store", () => ({ useSessionStore: { getState: () => ({}) } }));
vi.mock("@/runtime/host-features", () => ({
  selectHostFeature: () => supportsProjectRemove.current,
}));

vi.stubGlobal("React", React);

import { i18n } from "@/i18n/i18next";
import { RemoveProjectSection } from "./remove-project-section";

const project = {
  hosts: [{ serverId: "host-a", projectId: "project-a" }],
} as unknown as ProjectSummary;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  confirmDialog.mockReset();
  removeProject.mockClear();
  toastError.mockClear();
  supportsProjectRemove.current = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pressRemove(onRemoved: () => void) {
  act(() => {
    root.render(
      <RemoveProjectSection project={project} projectName="Project" onRemoved={onRemoved} />,
    );
  });
  const button = container.querySelector('[data-testid="project-settings-remove-button"]');
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
}

describe("RemoveProjectSection", () => {
  it("removes the project on every host after confirming, then leaves the page", async () => {
    confirmDialog.mockResolvedValue(true);
    const onRemoved = vi.fn();

    await pressRemove(onRemoved);

    expect(removeProject).toHaveBeenCalledWith("project-a");
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    confirmDialog.mockResolvedValue(false);
    const onRemoved = vi.fn();

    await pressRemove(onRemoved);

    expect(removeProject).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("asks to update a host that cannot remove projects", async () => {
    confirmDialog.mockResolvedValue(true);
    supportsProjectRemove.current = false;
    const onRemoved = vi.fn();

    await pressRemove(onRemoved);

    expect(removeProject).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Update the host to remove projects.");
  });
});
