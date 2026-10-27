import { compareMatchScores, scoreTextFields } from "@getpaseo/protocol/search/text-match";

export interface ModelPickerProjectOption {
  id: string;
  label: string;
  /** CUSTOM(project-favorites): the project view key the star is saved under; defaults to id. */
  favoriteKey?: string;
}

/**
 * CUSTOM(model-picker-project): a new conversation's project, offered as the picker's first row.
 * The New Workspace screen changes it in place. A draft tab can't move to another project, so its
 * `select` opens New Workspace for that project instead, and `leavesComposer` closes the picker.
 */
export interface ModelPickerProjectSource {
  selectedId: string | null;
  options: readonly ModelPickerProjectOption[];
  select(id: string): void;
  leavesComposer?: boolean;
}

export interface ModelPickerProjectItem {
  kind: "project-option";
  key: string;
  option: ModelPickerProjectOption;
  current: boolean;
}

export function currentProjectLabel(source: ModelPickerProjectSource): string {
  return source.options.find((option) => option.id === source.selectedId)?.label ?? "None";
}

/** Without a query: the current project first, then the rest in their order. With one: ranked. */
export function buildProjectPickerItems(
  source: ModelPickerProjectSource,
  query: string,
): ModelPickerProjectItem[] {
  const toItem = (option: ModelPickerProjectOption): ModelPickerProjectItem => ({
    kind: "project-option",
    key: `project-option:${option.id}`,
    option,
    current: option.id === source.selectedId,
  });
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const items = source.options.map(toItem);
    return [...items.filter((item) => item.current), ...items.filter((item) => !item.current)];
  }
  return source.options
    .flatMap((option) => {
      const score = scoreTextFields(normalized, [option.label]);
      return score ? [{ option, score }] : [];
    })
    .sort(
      (a, b) =>
        compareMatchScores(a.score, b.score) || a.option.label.localeCompare(b.option.label),
    )
    .map((entry) => toItem(entry.option));
}

/** What picking a project does: nothing (the current one), change it here, or leave the composer. */
export function planProjectPick(
  source: ModelPickerProjectSource,
  id: string,
): "none" | "select" | "select-and-close" {
  if (id === source.selectedId) return "none";
  return source.leavesComposer ? "select-and-close" : "select";
}
