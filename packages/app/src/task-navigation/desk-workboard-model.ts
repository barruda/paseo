// CUSTOM(desk-workboard): the plugin surfaces shown as tabs beside the Desks, and the persisted
// state of those tabs. Pure, so the migration can be tested without the app's storage.
import { z } from "zod";
import type { PluginSurfaceContributionIdentity } from "@/plugins/surface-contribution";

export interface DeskSurfaceDefinition {
  id: string;
  label: string;
  identity: PluginSurfaceContributionIdentity;
}

export const POWER_WORKBOARD_SURFACE_ID = "power-workboard";

/** Fixed order of the chips; all belong to the `power-workboard` plugin. */
export const DESK_SURFACES: readonly DeskSurfaceDefinition[] = [
  {
    id: POWER_WORKBOARD_SURFACE_ID,
    label: "Power Workboard",
    identity: { kind: "sidebar", id: POWER_WORKBOARD_SURFACE_ID },
  },
];

/**
 * CUSTOM(workboard-inner-pages): surfaces that used to be chips of their own and are now tabs
 * inside Power Workboard. Surface id -> the board's `params.tab` for that page.
 */
export const WORKBOARD_INNER_PAGES: Readonly<Record<string, string>> = {
  "projects-assistant-chat": "assistant-chat",
  "projects-dashboard": "dashboard",
  "projects-conversations": "conversations",
  "projects-reports": "reports",
};

export interface DeskSurfacesPersisted {
  /** Surface id -> tab is in the header. Missing means open. */
  open: Record<string, boolean>;
  /** The surface showing instead of the Desk's tabs. */
  selected: string | null;
  /** Power Workboard's inner tab, passed to it as `params.tab`. Null means its default. */
  tab: string | null;
}

const persistedSchema = z.object({
  open: z.record(z.string(), z.boolean()),
  selected: z.string().nullable(),
  tab: z.string().nullable(),
});
/** Version 2: one chip per surface, before the pages moved inside Power Workboard. */
const surfacesPersistedSchema = z.object({
  open: z.record(z.string(), z.boolean()),
  selected: z.string().nullable(),
});
const legacyPersistedSchema = z.object({
  open: z.boolean(),
  selected: z.boolean(),
});
/** Version 1 stored only Power Workboard's flags. The current shape goes first: zod strips keys. */
export const deskSurfacesStorageSchema = z.union([
  persistedSchema,
  surfacesPersistedSchema,
  legacyPersistedSchema,
]);

export function migrateDeskSurfaces(persisted: unknown): DeskSurfacesPersisted {
  const current = persistedSchema.safeParse(persisted);
  if (current.success) return current.data;
  const surfaces = surfacesPersistedSchema.safeParse(persisted);
  if (surfaces.success) {
    const { open, selected } = surfaces.data;
    const board = POWER_WORKBOARD_SURFACE_ID;
    const kept: Record<string, boolean> = board in open ? { [board]: open[board] } : {};
    const innerTab = selected ? WORKBOARD_INNER_PAGES[selected] : undefined;
    if (innerTab) return { open: { ...kept, [board]: true }, selected: board, tab: innerTab };
    return { open: kept, selected: selected === board ? board : null, tab: null };
  }
  const legacy = legacyPersistedSchema.safeParse(persisted);
  if (legacy.success) {
    return {
      open: { [POWER_WORKBOARD_SURFACE_ID]: legacy.data.open },
      selected: legacy.data.open && legacy.data.selected ? POWER_WORKBOARD_SURFACE_ID : null,
      tab: null,
    };
  }
  return { open: {}, selected: null, tab: null };
}

export function isDeskSurfaceOpen(open: Record<string, boolean>, id: string): boolean {
  return open[id] ?? true;
}

/**
 * Where `openDeskSurface(id)` lands: an inner page's id selects Power Workboard on that tab, any
 * other id selects its own chip.
 */
export function resolveDeskSurfaceTarget(id: string): { surfaceId: string; tab: string | null } {
  const tab = WORKBOARD_INNER_PAGES[id];
  return tab ? { surfaceId: POWER_WORKBOARD_SURFACE_ID, tab } : { surfaceId: id, tab: null };
}
