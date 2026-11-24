import { afterEach, describe, expect, it } from "vitest";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { opensNewWorkspaceAfterAddProject } from "./add-project-landing";

describe("opensNewWorkspaceAfterAddProject", () => {
  afterEach(() => {
    useTaskNavigationStore.setState({ enabled: false });
  });

  it("opens New workspace outside Tasks mode", () => {
    useTaskNavigationStore.setState({ enabled: false });
    expect(opensNewWorkspaceAfterAddProject()).toBe(true);
  });

  it("stays put in Tasks mode", () => {
    useTaskNavigationStore.setState({ enabled: true });
    expect(opensNewWorkspaceAfterAddProject()).toBe(false);
  });
});
