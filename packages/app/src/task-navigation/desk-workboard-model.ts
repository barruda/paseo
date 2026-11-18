// CUSTOM(desk-workboard): the plugin surfaces shown as tabs beside the Desks, and the persisted
// state of those tabs. Pure, so the migration can be tested without the app's storage.
import { z } from "zod";
import type { PluginSurfaceContributionIdentity } from "@/plugins/surface-contribution";

export interface DeskSurfaceDefinition {
  id: string;
  label: string;
  identity: PluginSurfaceContributionIdentity;
}

/** Fixed order of the chips; all belong to the `power-workboard` plugin. */
export const DESK_SURFACES: readonly DeskSurfaceDefinition[] = [
  {
    id: "power-workboard",
    label: "Power Workboard",
    identity: { kind: "sidebar", id: "power-workboard" },
  },
  {
    id: "projects-assistant-chat",
    label: "Projects Assistant",
    identity: { kind: "surface", id: "projects-assistant-chat" },
  },
  {
    id: "projects-dashboard",
    label: "Projects Dashboard",
    identity: { kind: "surface", id: "projects-dashboard" },
  },
  {
    id: "projects-conversations",
    label: "Projects Conversations",
    identity: { kind: "surface", id: "projects-conversations" },
  },
  // CUSTOM(assistant-reports): Projects Reports page, from the Power Workboard plugin.
  {
    id: "projects-reports",
    label: "Projects Reports",
    identity: { kind: "surface", id: "projects-reports" },
  },
];

export interface DeskSurfacesPersisted {
  /** Surface id -> tab is in the header. Missing means open. */
  open: Record<string, boolean>;
  /** The surface showing instead of the Desk's tabs. */
  selected: string | null;
}

const persistedSchema = z.object({
  open: z.record(z.string(), z.boolean()),
  selected: z.string().nullable(),
});
const legacyPersistedSchema = z.object({
  open: z.boolean(),
  selected: z.boolean(),
});
/** Version 1 stored only Power Workboard's flags. */
export const deskSurfacesStorageSchema = z.union([persistedSchema, legacyPersistedSchema]);

export function migrateDeskSurfaces(persisted: unknown): DeskSurfacesPersisted {
  const current = persistedSchema.safeParse(persisted);
  if (current.success) return current.data;
  const legacy = legacyPersistedSchema.safeParse(persisted);
  if (legacy.success) {
    return {
      open: { "power-workboard": legacy.data.open },
      selected: legacy.data.open && legacy.data.selected ? "power-workboard" : null,
    };
  }
  return { open: {}, selected: null };
}

export function isDeskSurfaceOpen(open: Record<string, boolean>, id: string): boolean {
  return open[id] ?? true;
}
