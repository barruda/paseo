// CUSTOM(board-desk-links)
import { describe, expect, it } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  DESK_LINKS,
  canOpenDeskSurfaces,
  deskLinkStrings,
  openDeskLink,
} from "../client/assistant/desk-links";
import {
  CONVERSATIONS_SURFACE_ID,
  DASHBOARD_SURFACE_ID,
  REPORTS_SURFACE_ID,
} from "../client/assistant/nav";

type Navigation = PluginSurfaceProps["navigation"];

function deskNavigation() {
  const opened: string[] = [];
  const navigation = {
    openAgent() {},
    openWorkspace() {},
    openDeskSurface: (id: string) => opened.push(id),
  } as unknown as Navigation;
  return { navigation, opened };
}

describe("board desk links", () => {
  it("lists Dashboard, Conversations and Reports in that order", () => {
    expect(DESK_LINKS.map((link) => [link.key, link.surfaceId])).toEqual([
      ["dashboard", DASHBOARD_SURFACE_ID],
      ["conversations", CONVERSATIONS_SURFACE_ID],
      ["reports", REPORTS_SURFACE_ID],
    ]);
  });

  it("opens each link's own Desk surface", () => {
    const { navigation, opened } = deskNavigation();
    expect(openDeskLink(navigation, "dashboard")).toBe(true);
    expect(openDeskLink(navigation, "conversations")).toBe(true);
    expect(openDeskLink(navigation, "reports")).toBe(true);
    expect(opened).toEqual([
      "projects-dashboard",
      "projects-conversations",
      "projects-reports",
    ]);
  });

  it("asks the Desk for the same surface on a second click", () => {
    const { navigation, opened } = deskNavigation();
    openDeskLink(navigation, "reports");
    openDeskLink(navigation, "reports");
    expect(opened).toEqual(["projects-reports", "projects-reports"]);
  });

  it("is hidden where the host has no Desk surfaces", () => {
    const plain = {
      openAgent() {},
      openWorkspace() {},
    } as unknown as Navigation;
    expect(canOpenDeskSurfaces(plain)).toBe(false);
    expect(canOpenDeskSurfaces(undefined)).toBe(false);
    expect(openDeskLink(plain, "dashboard")).toBe(false);
    expect(canOpenDeskSurfaces(deskNavigation().navigation)).toBe(true);
  });

  it("has English and Brazilian Portuguese labels", () => {
    expect(deskLinkStrings("en").dashboard.label).toBe("Dashboard");
    expect(deskLinkStrings("en").conversations.label).toBe("Conversations");
    expect(deskLinkStrings("en").reports.label).toBe("Reports");
    expect(deskLinkStrings("pt").reports.label).toBe("Relatórios");
    expect(deskLinkStrings("pt").conversations.hint).toBe(
      "Abrir Projects Conversations",
    );
  });
});
