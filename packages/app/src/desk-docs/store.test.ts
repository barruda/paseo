import { beforeEach, describe, expect, it } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { visibleProjects } from "./model";
import { useDeskDocsStore } from "./store";

const store = () => useDeskDocsStore.getState();

beforeEach(async () => {
  await AsyncStorage.clear();
  useDeskDocsStore.setState({
    docs: [],
    roots: [],
    sort: "recent",
    collapsedProjects: [],
    hiddenProjects: [],
    folderOverrides: {},
  });
});

describe("project filter", () => {
  it("hides and shows one project", () => {
    store().toggleProjectVisibility("srv:a");
    expect(store().hiddenProjects).toEqual(["srv:a"]);
    store().toggleProjectVisibility("srv:a");
    expect(store().hiddenProjects).toEqual([]);
  });

  it("hides all projects and shows them again", () => {
    store().hideAllProjects(["srv:a", "srv:b"]);
    expect(store().hiddenProjects).toEqual(["srv:a", "srv:b"]);
    store().showAllProjects();
    expect(store().hiddenProjects).toEqual([]);
  });

  it("keeps a project the user never hid visible, so a new project starts marked", () => {
    store().hideAllProjects(["srv:a"]);
    expect(
      visibleProjects([{ ref: "srv:a" }, { ref: "srv:new" }], store().hiddenProjects).map(
        (project) => project.ref,
      ),
    ).toEqual(["srv:new"]);
  });

  it("saves the hidden projects", async () => {
    store().hideAllProjects(["srv:a"]);
    expect(JSON.parse((await AsyncStorage.getItem("custom-desk-docs"))!)).toMatchObject({
      state: { hiddenProjects: ["srv:a"] },
    });
  });

  it("loads a state saved before the filter existed", async () => {
    const doc = {
      id: "d1",
      serverId: "srv",
      projectRef: "srv:p1",
      workspaceId: "ws1",
      name: "a.md",
      path: "/r/a.md",
      modifiedAt: 1,
    };
    await AsyncStorage.setItem(
      "custom-desk-docs",
      JSON.stringify({
        version: 1,
        state: { docs: [doc], roots: [], sort: "name", collapsedProjects: [] },
      }),
    );
    await useDeskDocsStore.persist.rehydrate();
    expect(store().docs).toEqual([doc]);
    expect(store().hiddenProjects).toEqual([]);
    expect(store().folderOverrides).toEqual({});
  });
});

describe("folder state", () => {
  it("remembers a folder the user closed or opened", async () => {
    store().setFolderExpanded("srv:p1|/repo/docs", false);
    store().setFolderExpanded("srv:p1|/repo/src", true);
    expect(store().folderOverrides).toEqual({
      "srv:p1|/repo/docs": false,
      "srv:p1|/repo/src": true,
    });
    expect(
      JSON.parse((await AsyncStorage.getItem("custom-desk-docs"))!).state.folderOverrides,
    ).toEqual({
      "srv:p1|/repo/docs": false,
      "srv:p1|/repo/src": true,
    });
  });

  it("loads a state saved before folders were remembered", async () => {
    await AsyncStorage.setItem(
      "custom-desk-docs",
      JSON.stringify({
        version: 1,
        state: {
          docs: [],
          roots: [],
          sort: "recent",
          collapsedProjects: [],
          hiddenProjects: [],
        },
      }),
    );
    await useDeskDocsStore.persist.rehydrate();
    expect(store().folderOverrides).toEqual({});
  });
});
