// CUSTOM(pm-composer-pills): the Project Manager chat (Workboard's `pwb/assistant-chat`) gets a
// leaner pill row: no Commit: wip, no Rename session, no Vitals RAM/disk warning, and Restart chat
// leads the row. Every other agent keeps the row as Settings > Chat Options orders it.

const RESTART_CHAT_KEY = "plugin:power-workboard:restart-chat";

/** Pills the Project Manager chat never shows. */
export const PROJECT_MANAGER_HIDDEN_PILLS: ReadonlySet<string> = new Set([
  "commit",
  "rename",
  "plugin:vitals:pressure",
]);

/** Drawn last, pushed right, in this order (CUSTOM(assistant-restart-pill)). */
const RIGHT_ALIGNED_ORDER = [RESTART_CHAT_KEY, "reading"];

export interface AboveRowLayout {
  /** Pills drawn from the left, in order. */
  row: string[];
  /** Pills grouped on the right, in order. */
  right: string[];
}

/** Splits the ordered pill keys between the row and its right-aligned group. */
export function layoutAboveRow(
  orderedKeys: readonly string[],
  isProjectManager: boolean,
): AboveRowLayout {
  if (!isProjectManager) {
    return {
      row: orderedKeys.filter((key) => !RIGHT_ALIGNED_ORDER.includes(key)),
      right: RIGHT_ALIGNED_ORDER.filter((key) => orderedKeys.includes(key)),
    };
  }
  const shown = orderedKeys.filter((key) => !PROJECT_MANAGER_HIDDEN_PILLS.has(key));
  const leading = shown.includes(RESTART_CHAT_KEY) ? [RESTART_CHAT_KEY] : [];
  return {
    row: [...leading, ...shown.filter((key) => key !== RESTART_CHAT_KEY && key !== "reading")],
    right: shown.includes("reading") ? ["reading"] : [],
  };
}
