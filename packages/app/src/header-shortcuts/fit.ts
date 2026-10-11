/** Room kept for the header's left side (sidebar toggle, title, branch) before any shortcut shows. */
export const TITLE_RESERVE_PX = 380;
/** Space between the strip and the header buttons. */
export const STRIP_MARGIN_PX = 30;
const ITEM_GAP_PX = 12;

/** A rough width for one shortcut: the key badge plus its label. Errs wide so nothing clips. */
export function estimateShortcutWidth(keysText: string, label: string): number {
  return 14 + keysText.length * 7.5 + 4 + label.length * 7;
}

/** How many shortcuts, in priority order, fit between the title's reserve and the buttons. */
export function countFittingShortcuts(input: {
  headerWidth: number;
  buttonsWidth: number;
  itemWidths: readonly number[];
}): number {
  const budget = input.headerWidth - input.buttonsWidth - TITLE_RESERVE_PX - STRIP_MARGIN_PX;
  let used = 0;
  let count = 0;
  for (const width of input.itemWidths) {
    const next = used + (count > 0 ? ITEM_GAP_PX : 0) + width;
    if (next > budget) break;
    used = next;
    count += 1;
  }
  return count;
}
