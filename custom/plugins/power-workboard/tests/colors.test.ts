import { describe, expect, it } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { groupColorValue, projectColor } from "../client/colors";
import { GROUP_COLORS } from "../shared/model";

type Theme = PluginSurfaceProps["theme"];

function theme(surface0: string): Theme {
  return { colors: { surface0 } } as unknown as Theme;
}

const PROJECT_COLORS = GROUP_COLORS.filter((color) => color !== "gray");

describe("projectColor", () => {
  it("returns the same color for the same project id", () => {
    const light = theme("#ffffff");
    expect(projectColor("paseo", light)).toBe(projectColor("paseo", light));
    expect(projectColor("paseo", light)).toBe(
      projectColor("paseo", theme("#ffffff")),
    );
  });

  it("stays inside the project palette in both themes", () => {
    for (const surface of ["#ffffff", "#0b0d10"]) {
      const current = theme(surface);
      const palette = PROJECT_COLORS.map((color) =>
        groupColorValue(color, current),
      );
      for (const id of ["paseo", "pipeline", "/home/bruno/paseo", "x"]) {
        expect(palette).toContain(projectColor(id, current));
      }
    }
  });

  it("uses the dark palette on a dark surface", () => {
    expect(projectColor("paseo", theme("#ffffff"))).not.toBe(
      projectColor("paseo", theme("#0b0d10")),
    );
  });

  it("spreads different projects across the palette", () => {
    const light = theme("#ffffff");
    const colors = new Set(
      Array.from({ length: 20 }, (_, index) =>
        projectColor(`project-${index}`, light),
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
