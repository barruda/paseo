import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function solidPng(red: number, green: number, blue: number): string {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < 4; index += 1) {
    png.data.set([red, green, blue, 255], index * 4);
  }
  return PNG.sync.write(png).toString("base64");
}

function bluePng(): string {
  return solidPng(0, 0, 255);
}

function setup(input: {
  projects: {
    projectId: string;
    projectKey?: string;
    projectIconRevision?: string;
    projectRootPath?: string;
    projectCustomIconRevision?: string | null;
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
          projectRootPath:
            project.projectRootPath ?? `/tmp/${project.projectId}`,
          projectKind: "git",
          projectIconRevision: project.projectIconRevision,
          projectCustomIconRevision: project.projectCustomIconRevision ?? null,
        })),
      }),
      subscribe: () => () => {},
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
    // The letter box keeps the app's identity fill even when the accent comes from the image.
    expect(byId.get("a")?.letterFill).toBe(
      identityAccent("remote:org/a").light,
    );
    expect(byId.get("b")?.letterFill).toBe(
      identityAccent("remote:org/b").light,
    );
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

describe("project icon images", () => {
  it("serves the image the app shows and its revision", async () => {
    const { host } = setup({
      projects: [{ projectId: "a", projectIconRevision: "one" }],
      icon: async () => ({ data: bluePng(), mimeType: "image/png" }),
    });
    const inventory = await host.inventory();
    expect(inventory.projects[0]?.iconRevision).toBe("one");
    expect(host.projectIcons()).toEqual({
      projects: [
        {
          id: "a",
          revision: "one",
          icon: { data: bluePng(), mimeType: "image/png" },
        },
      ],
    });
  });

  it("includes the SVG text for the native renderer", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="#123456"/></svg>`,
    ).toString("base64");
    const { host } = setup({
      projects: [{ projectId: "a", projectIconRevision: "svg" }],
      icon: async () => ({ data: svg, mimeType: "image/svg+xml" }),
    });
    await host.inventory();
    const icon = host.projectIcons().projects[0]?.icon;
    expect(icon?.mimeType).toBe("image/svg+xml");
    expect(icon?.svg).toContain("<rect");
  });

  it("resolves a symlink and its target to the definition with the icon", async () => {
    const root = mkdtempSync(join(tmpdir(), "pwb-symlink-"));
    const target = join(root, "pipeline");
    const link = join(root, "pipeline-link");
    mkdirSync(target);
    symlinkSync(target, link, "dir");
    try {
      const { host } = setup({
        projects: [
          {
            projectId: "link",
            projectRootPath: link,
            projectIconRevision: "none",
          },
          {
            projectId: "target",
            projectRootPath: target,
            projectIconRevision: "target-icon",
          },
        ],
        icon: async (projectId) =>
          projectId === "target"
            ? { data: bluePng(), mimeType: "image/png" }
            : null,
      });
      const inventory = await host.inventory();
      for (const project of inventory.projects) {
        expect(project.accent).toEqual(accentFromDominantColor("#0000ff"));
        expect(project.iconRevision).toBe("target-icon");
      }
      const icons = new Map(
        host
          .projectIcons()
          .projects.map((project) => [project.id, project.icon]),
      );
      expect(icons.get("link")).toEqual({
        data: bluePng(),
        mimeType: "image/png",
      });
      expect(icons.get("target")).toEqual({
        data: bluePng(),
        mimeType: "image/png",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers a hand-picked icon over an automatic one for a project without an icon", async () => {
    const root = mkdtempSync(join(tmpdir(), "pwb-symlink-"));
    const shared = join(root, "shared");
    mkdirSync(shared);
    try {
      const { host } = setup({
        projects: [
          { projectId: "board", projectRootPath: shared },
          { projectId: "automatic", projectRootPath: shared },
          {
            projectId: "custom",
            projectRootPath: shared,
            projectCustomIconRevision: "picked",
          },
        ],
        icon: async (projectId) =>
          projectId === "custom"
            ? { data: solidPng(0, 255, 0), mimeType: "image/png" }
            : projectId === "automatic"
              ? { data: bluePng(), mimeType: "image/png" }
              : null,
      });
      await host.inventory();
      const icons = new Map(
        host
          .projectIcons()
          .projects.map((project) => [project.id, project.icon]),
      );
      expect(icons.get("board")).toEqual({
        data: solidPng(0, 255, 0),
        mimeType: "image/png",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps each placement's letter color when no definition has an icon", async () => {
    const root = mkdtempSync(join(tmpdir(), "pwb-symlink-"));
    const shared = join(root, "shared");
    mkdirSync(shared);
    try {
      const { host } = setup({
        projects: [
          { projectId: "a", projectRootPath: shared },
          { projectId: "b", projectRootPath: shared },
        ],
        icon: async () => null,
      });
      const inventory = await host.inventory();
      const byId = new Map(inventory.projects.map((p) => [p.id, p]));
      expect(byId.get("a")?.accent).toEqual(
        identityAccent(JSON.stringify(["srv", "a"])),
      );
      expect(byId.get("b")?.accent).toEqual(
        identityAccent(JSON.stringify(["srv", "b"])),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serves the new image after the definition's revision changes", async () => {
    const projects = [{ projectId: "a", projectIconRevision: "one" }];
    let color = bluePng();
    const { host } = setup({
      projects,
      icon: async () => ({ data: color, mimeType: "image/png" }),
    });
    await host.inventory();
    expect(host.projectIcons().projects[0]?.icon?.data).toBe(bluePng());
    color = solidPng(255, 0, 0);
    projects[0]!.projectIconRevision = "two";
    await host.inventory();
    const project = host.projectIcons().projects[0];
    expect(project?.revision).toBe("two");
    expect(project?.icon?.data).toBe(solidPng(255, 0, 0));
  });
});
