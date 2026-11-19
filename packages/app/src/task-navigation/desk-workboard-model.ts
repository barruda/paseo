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
 * inside Power Workboard. Surface id -> the board's `params.tab` for that page. The assistant chat
 * maps to null: its tab opens the chat agent on mount, so asking for it would reopen the chat every
 * time the board shows.
 */
export const WORKBOARD_INNER_PAGES: Readonly<Record<string, string | null>> = {
  "projects-assistant-chat": null,
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
    if (selected && Object.hasOwn(WORKBOARD_INNER_PAGES, selected))
      return {
        open: { ...kept, [board]: true },
        selected: board,
        tab: WORKBOARD_INNER_PAGES[selected],
      };
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
  if (!Object.hasOwn(WORKBOARD_INNER_PAGES, id)) return { surfaceId: id, tab: null };
  return { surfaceId: POWER_WORKBOARD_SURFACE_ID, tab: WORKBOARD_INNER_PAGES[id] };
}

// CUSTOM(workboard-chip-only): in Tasks mode every way of opening Power Workboard (sidebar row,
// Command Center, a plugin's `openScreen`, the workspace panel) selects its Desk chip instead of
// opening the plugin page or a workspace tab.
export const POWER_WORKBOARD_PLUGIN_ID = "power-workboard";

/** Where an open of `pluginId`'s screen `screenId` lands in Tasks mode; null keeps the default. */
export function resolveWorkboardOpen(input: {
  tasksMode: boolean;
  pluginId: string;
  screenId: string;
  params?: Readonly<Record<string, string>>;
}): { surfaceId: string; tab: string | null } | null {
  if (!input.tasksMode || input.pluginId !== POWER_WORKBOARD_PLUGIN_ID) return null;
  const known =
    DESK_SURFACES.some((surface) => surface.id === input.screenId) ||
    Object.hasOwn(WORKBOARD_INNER_PAGES, input.screenId);
  if (!known) return null;
  const target = resolveDeskSurfaceTarget(input.screenId);
  return { surfaceId: target.surfaceId, tab: input.params?.tab ?? target.tab };
}

/** The board's workspace panel ("+" menu, "Open Power Workboard tab"): the chip in Tasks mode. */
export function isWorkboardPanel(pluginId: string, panelId: string): boolean {
  return pluginId === POWER_WORKBOARD_PLUGIN_ID && panelId === POWER_WORKBOARD_SURFACE_ID;
}

/**
 * CUSTOM(workboard-chip-status): the counts behind the chip's status icon. Same contract as
 * `deskStatusRpc` in custom/plugins/power-workboard/shared/rpc.ts; keep the two in step.
 */
export const DESK_STATUS_RPC_NAME = "workboard.desk-status";
export const deskStatusSchema = z.object({
  running: z.number().int(),
  review: z.number().int(),
  needsYou: z.number().int(),
});
export type DeskWorkboardStatus = z.infer<typeof deskStatusSchema>;

/**
 * The agent-tab state the chip borrows. Needs you is the agent waiting for you (amber alert),
 * Ready to review is the agent that finished and waits for your look (attention dot), and a task
 * running is the running ring. The icon has one corner, so the state that wants the user wins.
 */
export function deskWorkboardStatusBucket(
  status: DeskWorkboardStatus | null | undefined,
): "needs_input" | "attention" | "running" | null {
  if (!status) return null;
  if (status.needsYou > 0) return "needs_input";
  if (status.review > 0) return "attention";
  if (status.running > 0) return "running";
  return null;
}
