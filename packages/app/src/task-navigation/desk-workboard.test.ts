import { describe, expect, it } from "vitest";
import {
  DESK_SURFACES,
  deskStatusPollMs,
  deskStatusSchema,
  deskSurfacesStorageSchema,
  deskWorkboardStatusBucket,
  isDeskSurfaceOpen,
  isWorkboardPanel,
  migrateDeskSurfaces,
  resolveDeskSurfaceTarget,
  resolveWorkboardOpen,
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

// CUSTOM(workboard-chip-only)
describe("opening Power Workboard in Tasks mode", () => {
  const open = (screenId: string, params?: Record<string, string>, tasksMode = true) =>
    resolveWorkboardOpen({ tasksMode, pluginId: "power-workboard", screenId, params });

  it("lands on the chip for the sidebar row, the Command Center and the inner pages", () => {
    expect(open("power-workboard")).toEqual({ surfaceId: "power-workboard", tab: null });
    expect(open("projects-reports")).toEqual({ surfaceId: "power-workboard", tab: "reports" });
    expect(open("power-workboard", { tab: "reports", request: "1" })).toEqual({
      surfaceId: "power-workboard",
      tab: "reports",
    });
  });

  it("keeps the default open outside Tasks mode, for other screens and other plugins", () => {
    expect(open("power-workboard", undefined, false)).toBeNull();
    expect(open("power-workboard-settings")).toBeNull();
    expect(
      resolveWorkboardOpen({ tasksMode: true, pluginId: "warp", screenId: "power-workboard" }),
    ).toBeNull();
  });

  it("recognizes only the board's own workspace panel", () => {
    expect(isWorkboardPanel("power-workboard", "power-workboard")).toBe(true);
    expect(isWorkboardPanel("power-workboard", "other")).toBe(false);
    expect(isWorkboardPanel("warp", "power-workboard")).toBe(false);
  });
});

// CUSTOM(workboard-chip-status)
describe("Power Workboard chip status", () => {
  const status = (running: number, review: number, needsYou: number) =>
    deskStatusSchema.parse({ running, review, needsYou });

  it("is clean with nothing going on or before the plugin answers", () => {
    expect(deskWorkboardStatusBucket(status(0, 0, 0))).toBeNull();
    expect(deskWorkboardStatusBucket(null)).toBeNull();
  });

  it("shows the running ring while a task runs", () => {
    expect(deskWorkboardStatusBucket(status(2, 0, 0))).toBe("running");
  });

  it("shows the review dot for Ready to review and the alert for Needs you", () => {
    expect(deskWorkboardStatusBucket(status(0, 1, 0))).toBe("attention");
    expect(deskWorkboardStatusBucket(status(0, 0, 1))).toBe("needs_input");
  });

  it("lets what waits for the user win over a running task", () => {
    expect(deskWorkboardStatusBucket(status(3, 1, 0))).toBe("attention");
    expect(deskWorkboardStatusBucket(status(3, 1, 2))).toBe("needs_input");
  });
});

// CUSTOM(workboard-chip-status)
describe("Power Workboard chip polling", () => {
  it("asks every 3 s while the plugin answers and every 60 s after a failure", () => {
    expect(deskStatusPollMs(false)).toBe(3_000);
    expect(deskStatusPollMs(true)).toBe(60_000);
  });
});
