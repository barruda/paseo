import { describe, expect, it } from "vitest";
import {
  GRAY_ACCENT,
  accentFromDominantColor,
  identityAccent,
  projectPaletteAccent,
  projectViewKeys,
  resolveProjectAccent,
  resolveProjectDefinitions,
} from "../shared/project-color";

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("projectViewKeys", () => {
  it("uses the project key when it is unique on the server", () => {
    const keys = projectViewKeys(
      [
        { projectId: "a", projectKey: "remote:github.com/org/a" },
        { projectId: "b", projectKey: "remote:github.com/org/b" },
      ],
      "srv",
    );
    expect(keys.get("a")).toBe("remote:github.com/org/a");
    expect(keys.get("b")).toBe("remote:github.com/org/b");
  });

  it("falls back to the server placement when two projects share a key", () => {
    const keys = projectViewKeys(
      [
        { projectId: "a", projectKey: "remote:github.com/org/same" },
        { projectId: "b", projectKey: "remote:github.com/org/same" },
      ],
      "srv",
    );
    expect(keys.get("a")).toBe(JSON.stringify(["srv", "a"]));
    expect(keys.get("b")).toBe(JSON.stringify(["srv", "b"]));
  });

  it("allocates a distinct key when the placement key is taken", () => {
    const placement = JSON.stringify(["srv", "a"]);
    const keys = projectViewKeys(
      [{ projectId: "a" }, { projectId: "b", projectKey: placement }],
      "srv",
    );
    expect(keys.get("b")).toBe(placement);
    expect(keys.get("a")).not.toBe(placement);
    expect(keys.get("a")).toContain("placement");
  });
});

describe("identityAccent", () => {
  it("matches the app's letter color for a project placement", () => {
    const viewKey = JSON.stringify([
      "srv_pBTNOVmYAGQw",
      "prj_1b497e9066c32377",
    ]);
    expect(identityAccent(viewKey)).toEqual({
      light: "#7a6aa8",
      dark: "#a392d5",
    });
  });
});

describe("accentFromDominantColor", () => {
  it("builds a light and a dark variant with readable contrast", () => {
    const accent = accentFromDominantColor("#1a90e7");
    expect(accent).not.toBeNull();
    if (!accent) return;
    expect(contrast(accent.light, "#ffffff")).toBeGreaterThanOrEqual(3.9);
    expect(contrast(accent.dark, "#282c34")).toBeGreaterThanOrEqual(3.9);
    expect(accent.light).not.toBe(accent.dark);
  });

  it("keeps a yellow readable instead of returning the raw color", () => {
    const accent = accentFromDominantColor("#ffe600");
    expect(accent).not.toBeNull();
    if (!accent) return;
    expect(contrast(accent.light, "#ffffff")).toBeGreaterThanOrEqual(3.9);
  });

  it("has no accent for a gray icon", () => {
    expect(accentFromDominantColor("#808080")).toBeNull();
    expect(accentFromDominantColor("#383d42")).toBeNull();
  });
});

describe("resolveProjectAccent", () => {
  const id = "prj_1";

  it("prefers a manual color over the icon", () => {
    expect(
      resolveProjectAccent({
        id,
        manualColor: "pink",
        image: { kind: "color", color: "#00ff00" },
      }),
    ).toEqual({ light: "#be185d", dark: "#f472b6" });
  });

  it("uses the icon's dominant color", () => {
    const accent = resolveProjectAccent({
      id,
      image: { kind: "color", color: "#1a90e7" },
    });
    expect(accent).toEqual(accentFromDominantColor("#1a90e7"));
  });

  it("uses the app's letter color when the project has no image", () => {
    const viewKey = JSON.stringify(["srv", "prj_1"]);
    expect(resolveProjectAccent({ id, viewKey, image: null })).toEqual(
      identityAccent(viewKey),
    );
  });

  it("uses gray for a monochrome image", () => {
    expect(resolveProjectAccent({ id, image: { kind: "monochrome" } })).toEqual(
      GRAY_ACCENT,
    );
  });

  it("falls back to the stable palette when the icon is unknown", () => {
    expect(resolveProjectAccent({ id })).toEqual(projectPaletteAccent(id));
    expect(
      resolveProjectAccent({ id, image: { kind: "unsupported" } }),
    ).toEqual(projectPaletteAccent(id));
  });
});

describe("resolveProjectDefinitions", () => {
  it("keeps a project that has its own icon", () => {
    const definitions = resolveProjectDefinitions([
      {
        projectId: "a",
        realPath: "/repo",
        hasIcon: true,
        customIcon: false,
      },
      {
        projectId: "b",
        realPath: "/repo",
        hasIcon: true,
        customIcon: true,
      },
    ]);
    expect(definitions.get("a")).toBe("a");
    expect(definitions.get("b")).toBe("b");
  });

  it("takes the icon from a sibling on the same real path", () => {
    const definitions = resolveProjectDefinitions([
      {
        projectId: "link",
        realPath: "/repo",
        hasIcon: false,
        customIcon: false,
      },
      {
        projectId: "target",
        realPath: "/repo",
        hasIcon: true,
        customIcon: false,
      },
    ]);
    expect(definitions.get("link")).toBe("target");
  });

  it("prefers a hand-picked icon, then the lowest project id", () => {
    const definitions = resolveProjectDefinitions([
      {
        projectId: "board",
        realPath: "/repo",
        hasIcon: false,
        customIcon: false,
      },
      {
        projectId: "automatic",
        realPath: "/repo",
        hasIcon: true,
        customIcon: false,
      },
      {
        projectId: "picked",
        realPath: "/repo",
        hasIcon: true,
        customIcon: true,
      },
    ]);
    expect(definitions.get("board")).toBe("picked");
    expect(
      resolveProjectDefinitions([
        {
          projectId: "board",
          realPath: "/repo",
          hasIcon: false,
          customIcon: false,
        },
        {
          projectId: "z",
          realPath: "/repo",
          hasIcon: true,
          customIcon: false,
        },
        {
          projectId: "a",
          realPath: "/repo",
          hasIcon: true,
          customIcon: false,
        },
      ]).get("board"),
    ).toBe("a");
  });

  it("keeps the project itself when nothing on its path has an icon", () => {
    const definitions = resolveProjectDefinitions([
      {
        projectId: "a",
        realPath: "/repo",
        hasIcon: false,
        customIcon: false,
      },
      {
        projectId: "b",
        realPath: "/repo",
        hasIcon: false,
        customIcon: false,
      },
    ]);
    expect(definitions.get("a")).toBe("a");
    expect(definitions.get("b")).toBe("b");
  });

  it("does not match different real paths", () => {
    const definitions = resolveProjectDefinitions([
      {
        projectId: "a",
        realPath: "/one",
        hasIcon: false,
        customIcon: false,
      },
      {
        projectId: "b",
        realPath: "/two",
        hasIcon: true,
        customIcon: false,
      },
    ]);
    expect(definitions.get("a")).toBe("a");
  });
});
