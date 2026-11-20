import { describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import type {
  OwnedSubscription,
  PaseoApi,
  SubscriptionObserver,
} from "@getpaseo/client";
import { PaseoHost } from "../server/host";
import type { PaseoCompat } from "../server/paseo-compat";
import {
  accentFromDominantColor,
  identityAccent,
} from "../shared/project-color";

function subscribe() {
  return {
    ready: Promise.resolve({ subscriptionId: "s" }),
    subscriptionId: "s",
    release: vi.fn(async () => {}),
    subscribe: (observer: SubscriptionObserver<unknown>) => {
      observer.snapshot({ subscriptionId: "s" });
      return () => {};
    },
  } as unknown as OwnedSubscription<unknown>;
}

function bluePng(): string {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < 4; index += 1) {
    png.data.set([0, 0, 255, 255], index * 4);
  }
  return PNG.sync.write(png).toString("base64");
}

function setup(input: {
  projects: {
    projectId: string;
    projectKey?: string;
    projectIconRevision?: string;
  }[];
  icon: (projectId: string) => Promise<{
    data: string;
    mimeType: string;
  } | null>;
}) {
  const api = {
    observeEvents: subscribe,
    workspaces: {
      list: async (options: { subscribe?: object }) => ({
        entries: [],
        subscription: options.subscribe ? subscribe() : undefined,
        pageInfo: { nextCursor: null, hasMore: false },
      }),
    },
    agents: {
      list: async (options: { subscribe?: object }) => ({
        entries: [],
        subscription: options.subscribe ? subscribe() : undefined,
        pageInfo: { nextCursor: null, hasMore: false },
      }),
    },
    projects: {
      list: async () => ({
        projects: input.projects.map((project) => ({
          projectId: project.projectId,
          projectKey: project.projectKey,
          projectDisplayName: project.projectId,
          projectCustomName: null,
          projectRootPath: `/tmp/${project.projectId}`,
          projectKind: "git",
          projectIconRevision: project.projectIconRevision,
        })),
      }),
    },
  };
  const compat = { projectIcon: vi.fn(input.icon) };
  const host = new PaseoHost(
    api as unknown as PaseoApi,
    compat as unknown as PaseoCompat,
    { serverId: "srv", version: "0.13.0" },
    () => {},
  );
  return { host, compat };
}

describe("project accents from the icon", () => {
  it("uses the icon's dominant color, and the letter color without an icon", async () => {
    const { host } = setup({
      projects: [
        { projectId: "a", projectKey: "remote:org/a" },
        { projectId: "b", projectKey: "remote:org/b" },
      ],
      icon: async (projectId) =>
        projectId === "a" ? { data: bluePng(), mimeType: "image/png" } : null,
    });
    const inventory = await host.inventory();
    const byId = new Map(inventory.projects.map((p) => [p.id, p]));
    expect(byId.get("a")?.accent).toEqual(accentFromDominantColor("#0000ff"));
    expect(byId.get("b")?.accent).toEqual(identityAccent("remote:org/b"));
  });

  it("reads an icon once per revision", async () => {
    const { host, compat } = setup({
      projects: [{ projectId: "a", projectIconRevision: "one" }],
      icon: async () => ({ data: bluePng(), mimeType: "image/png" }),
    });
    await host.inventory();
    await host.inventory();
    expect(compat.projectIcon).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the icon revision changes", async () => {
    const projects = [{ projectId: "a", projectIconRevision: "one" }];
    const { host, compat } = setup({
      projects,
      icon: async () => ({ data: bluePng(), mimeType: "image/png" }),
    });
    await host.inventory();
    projects[0]!.projectIconRevision = "two";
    await host.inventory();
    expect(compat.projectIcon).toHaveBeenCalledTimes(2);
  });

  it("recomputes the letter accent when the project's view key changes", async () => {
    const projects = [
      { projectId: "a", projectKey: "shared", projectIconRevision: "same" },
      { projectId: "b", projectKey: "shared", projectIconRevision: "same" },
    ];
    const { host } = setup({ projects, icon: async () => null });
    const first = await host.inventory();
    expect(first.projects.find((p) => p.id === "a")?.accent).toEqual(
      identityAccent(JSON.stringify(["srv", "a"])),
    );
    projects[1]!.projectKey = "other";
    const second = await host.inventory();
    expect(second.projects.find((p) => p.id === "a")?.accent).toEqual(
      identityAccent("shared"),
    );
  });

  it("waits a minute before retrying an icon that failed", async () => {
    const { host, compat } = setup({
      projects: [{ projectId: "a", projectIconRevision: "one" }],
      icon: async () => {
        throw new Error("no icon");
      },
    });
    await host.inventory();
    await host.inventory();
    expect(compat.projectIcon).toHaveBeenCalledTimes(1);
  });

  it("leaves the project on the palette when the icon cannot be read", async () => {
    const { host } = setup({
      projects: [{ projectId: "a", projectIconRevision: "one" }],
      icon: async () => {
        throw new Error("no icon");
      },
    });
    const inventory = await host.inventory();
    expect(inventory.projects[0]?.accent).toBeUndefined();
  });
});
