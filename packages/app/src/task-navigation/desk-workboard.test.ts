import { describe, expect, it } from "vitest";
import {
  DESK_SURFACES,
  deskSurfacesStorageSchema,
  isDeskSurfaceOpen,
  migrateDeskSurfaces,
  resolveDeskSurfaceTarget,
} from "./desk-workboard-model";

describe("desk surfaces persisted state", () => {
  it("keeps the old open/selected meaning for Power Workboard", () => {
    expect(migrateDeskSurfaces({ open: false, selected: false })).toEqual({
      open: { "power-workboard": false },
      selected: null,
      tab: null,
    });
    expect(migrateDeskSurfaces({ open: true, selected: true })).toEqual({
      open: { "power-workboard": true },
      selected: "power-workboard",
      tab: null,
    });
  });

  it("passes current state through and resets garbage", () => {
    const current = {
      open: { "power-workboard": false },
      selected: null,
      tab: "reports",
    };
    expect(migrateDeskSurfaces(current)).toEqual(current);
    expect(migrateDeskSurfaces("nope")).toEqual({ open: {}, selected: null, tab: null });
  });
});

// CUSTOM(workboard-inner-pages)
describe("Projects Assistant pages inside Power Workboard", () => {
  it("shows only Power Workboard as a chip", () => {
    expect(DESK_SURFACES.map((surface) => surface.id)).toEqual(["power-workboard"]);
  });

  it("moves a selected page chip to Power Workboard on that page's tab", () => {
    expect(
      migrateDeskSurfaces({
        open: { "power-workboard": false, "projects-reports": true, "projects-dashboard": false },
        selected: "projects-reports",
      }),
    ).toEqual({ open: { "power-workboard": true }, selected: "power-workboard", tab: "reports" });
    expect(migrateDeskSurfaces({ open: {}, selected: "projects-conversations" }).tab).toBe(
      "conversations",
    );
  });

  it("moves a selected assistant chat chip to Power Workboard without asking for the chat", () => {
    expect(
      migrateDeskSurfaces({
        open: { "power-workboard": false, "projects-assistant-chat": true },
        selected: "projects-assistant-chat",
      }),
    ).toEqual({ open: { "power-workboard": true }, selected: "power-workboard", tab: null });
    expect(resolveDeskSurfaceTarget("projects-assistant-chat")).toEqual({
      surfaceId: "power-workboard",
      tab: null,
    });
  });

  it("drops the page chips' flags and keeps Power Workboard's", () => {
    expect(
      migrateDeskSurfaces({
        open: { "power-workboard": false, "projects-dashboard": false },
        selected: null,
      }),
    ).toEqual({ open: { "power-workboard": false }, selected: null, tab: null });
    expect(
      migrateDeskSurfaces({ open: { "projects-dashboard": true }, selected: "power-workboard" }),
    ).toEqual({ open: {}, selected: "power-workboard", tab: null });
    const migrated = migrateDeskSurfaces({ open: {}, selected: "gone" });
    expect(migrated.selected).toBeNull();
    expect(isDeskSurfaceOpen(migrated.open, "power-workboard")).toBe(true);
  });

  it("keeps the inner tab when the storage schema reads version 3", () => {
    const stored = { open: {}, selected: "power-workboard", tab: "dashboard" };
    expect(deskSurfacesStorageSchema.parse(stored)).toEqual(stored);
  });

  it("opens a page's id as Power Workboard on that tab", () => {
    expect(resolveDeskSurfaceTarget("projects-dashboard")).toEqual({
      surfaceId: "power-workboard",
      tab: "dashboard",
    });
    expect(resolveDeskSurfaceTarget("power-workboard")).toEqual({
      surfaceId: "power-workboard",
      tab: null,
    });
  });
});
