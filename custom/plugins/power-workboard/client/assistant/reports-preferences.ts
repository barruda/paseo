// CUSTOM(assistant-reports): the Projects Reports status filter, saved per viewer in the browser.
// Native has no localStorage, so the default applies there on every open.
type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

declare const localStorage: StorageLike | undefined;

const storageKey = (host: string) =>
  `power-workboard:reports-hidden-columns:${host}`;

/** The hidden column ids the viewer saved; null when nothing valid was saved. */
export function loadReportHiddenColumnsFrom(
  storage: StorageLike,
  host: string,
): string[] | null {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(storageKey(host)) ?? "null",
    );
    if (!Array.isArray(value)) return null;
    return [
      ...new Set(
        value.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ];
  } catch {
    return null;
  }
}

export function saveReportHiddenColumnsTo(
  storage: StorageLike,
  host: string,
  ids: readonly string[],
): boolean {
  try {
    storage.setItem(storageKey(host), JSON.stringify([...new Set(ids)]));
    return true;
  } catch {
    return false;
  }
}

export function loadReportHiddenColumns(host: string): string[] | null {
  try {
    return typeof localStorage === "undefined"
      ? null
      : loadReportHiddenColumnsFrom(localStorage, host);
  } catch {
    return null;
  }
}

export function saveReportHiddenColumns(
  host: string,
  ids: readonly string[],
): boolean {
  try {
    return (
      typeof localStorage === "undefined" ||
      saveReportHiddenColumnsTo(localStorage, host, ids)
    );
  } catch {
    return false;
  }
}
