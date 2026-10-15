import { beforeEach, describe, expect, it } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useTaskNavigationStore } from "./store";

describe("task navigation mode", () => {
  beforeEach(async () => {
    await useTaskNavigationStore.persist.rehydrate();
    useTaskNavigationStore.getState().setEnabled(false);
  });
  it("returns to the workspace sidebar without losing its grouping or filters", () => {
    useSidebarViewStore.setState({
      groupMode: "status",
      projectFilters: ["project-a"],
      hostFilters: ["home"],
    });
    const { setEnabled } = useTaskNavigationStore.getState();
    setEnabled(true);
    expect(useTaskNavigationStore.getState().enabled).toBe(true);
    setEnabled(false);
    expect(useTaskNavigationStore.getState().enabled).toBe(false);
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      projectFilters: ["project-a"],
      hostFilters: ["home"],
    });
  });
  it("persists the mode separately from workspace sidebar preferences", async () => {
    useTaskNavigationStore.getState().setEnabled(true);
    expect(JSON.parse((await AsyncStorage.getItem("custom-task-navigation"))!)).toEqual({
      version: 1,
      state: { enabled: true },
    });
  });
});
