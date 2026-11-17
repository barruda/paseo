import { describe, expect, it } from "vitest";
import { isDeskSurfaceOpen, migrateDeskSurfaces } from "./desk-workboard-model";

describe("desk surfaces persisted state", () => {
  it("keeps the old open/selected meaning for Power Workboard", () => {
    expect(migrateDeskSurfaces({ open: false, selected: false })).toEqual({
      open: { "power-workboard": false },
      selected: null,
    });
    expect(migrateDeskSurfaces({ open: true, selected: true })).toEqual({
      open: { "power-workboard": true },
      selected: "power-workboard",
    });
  });

  it("opens the new surfaces by default", () => {
    const migrated = migrateDeskSurfaces({ open: false, selected: false });
    expect(isDeskSurfaceOpen(migrated.open, "projects-dashboard")).toBe(true);
    expect(isDeskSurfaceOpen(migrated.open, "power-workboard")).toBe(false);
  });

  it("passes current state through and resets garbage", () => {
    const current = {
      open: { "projects-dashboard": false },
      selected: "projects-dashboard",
    };
    expect(migrateDeskSurfaces(current)).toEqual(current);
    expect(migrateDeskSurfaces("nope")).toEqual({ open: {}, selected: null });
  });
});
