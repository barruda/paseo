// CUSTOM(shortcut-file): save the shortcut overrides to a JSON file and load them back.
import { z } from "zod";
import {
  DEFAULT_BINDINGS,
  MAX_SHORTCUTS_PER_ACTION,
  type ShortcutOverrides,
} from "@/keyboard/keyboard-shortcuts";
import { parseChordString } from "@/keyboard/shortcut-string";
import type { ShortcutOverrideValue } from "@/keyboard/shortcut-override-store";

export const SHORTCUT_FILE_NAME = "paseo-shortcuts.json";
const SHORTCUT_FILE_FORMAT = "paseo-shortcuts";
const SHORTCUT_FILE_VERSION = 1;

const ShortcutFileSchema = z.object({
  format: z.literal(SHORTCUT_FILE_FORMAT),
  version: z.number().int().positive(),
  // `null` is an unassigned shortcut; an absent id is the default combo.
  shortcuts: z.record(z.string(), z.string().nullable()),
});

export type ParseShortcutFileResult =
  | { ok: true; overrides: ShortcutOverrides; skipped: string[] }
  | { ok: false; reason: "invalid-json" | "invalid-format" | "newer-version" };

/** The file holds only what the user changed, so a fresh install loads it as the same setup. */
export function serializeShortcutFile(overrides: ShortcutOverrides): string {
  const sorted = Object.fromEntries(
    Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  return `${JSON.stringify(
    { format: SHORTCUT_FILE_FORMAT, version: SHORTCUT_FILE_VERSION, shortcuts: sorted },
    null,
    2,
  )}\n`;
}

/**
 * Reads a shortcut file. Entries for bindings this build does not have, or with a combo it cannot
 * parse, are skipped and listed rather than failing the whole file: a file saved from another
 * version still loads what it can.
 */
export function parseShortcutFile(text: string): ParseShortcutFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  const parsed = ShortcutFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid-format" };
  if (parsed.data.version > SHORTCUT_FILE_VERSION) return { ok: false, reason: "newer-version" };

  const overrides: ShortcutOverrides = {};
  const skipped: string[] = [];
  for (const [bindingId, combo] of Object.entries(parsed.data.shortcuts)) {
    if (isKnownBindingId(bindingId) && isUsableCombo(combo)) {
      overrides[bindingId] = combo;
    } else {
      skipped.push(bindingId);
    }
  }
  return { ok: true, overrides, skipped };
}

/**
 * The changes that turn `current` into `next`: every id in `next` gets its value, every id only in
 * `current` is dropped. Loading a file replaces the setup instead of merging into it.
 */
export function diffShortcutOverrides(
  current: ShortcutOverrides,
  next: ShortcutOverrides,
): Record<string, ShortcutOverrideValue> {
  const changes: Record<string, ShortcutOverrideValue> = {};
  for (const bindingId of Object.keys(current)) {
    if (!(bindingId in next)) changes[bindingId] = undefined;
  }
  for (const [bindingId, combo] of Object.entries(next)) {
    if (current[bindingId] !== combo || !(bindingId in current)) changes[bindingId] = combo;
  }
  return changes;
}

function isKnownBindingId(bindingId: string): boolean {
  const match = /^(.*?)(?:#(\d+))?$/.exec(bindingId);
  if (!match) return false;
  const [, baseId, slot] = match;
  if (slot !== undefined) {
    const slotNumber = Number(slot);
    if (slotNumber < 2 || slotNumber > MAX_SHORTCUTS_PER_ACTION) return false;
  }
  return DEFAULT_BINDINGS.some((binding) => binding.id === baseId);
}

function isUsableCombo(combo: string | null): boolean {
  if (combo === null) return true;
  try {
    parseChordString(combo);
    return true;
  } catch {
    return false;
  }
}
