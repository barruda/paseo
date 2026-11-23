// CUSTOM(task-panel): the card's context menu entries, kept pure so the behavior is testable.
import { isTerminalGroup, type Card, type Group } from "../shared/model";
import type { strings } from "./strings";

export type CardMenuItem = {
  id: string;
  label: string;
  icon: string;
  /** CUSTOM(delete-task): drawn in the danger color. */
  destructive?: boolean;
  onPress(): void;
};

/**
 * CUSTOM(archive-task): a bound card in Done or Canceled can be archived by hand. A canceled
 * draft keeps its own Archive draft action.
 */
export function canArchiveTask(card: Card, groups: readonly Group[]): boolean {
  return (
    card.workspaceId !== null &&
    !card.binding &&
    !card.archived &&
    isTerminalGroup(card.stage, groups)
  );
}

export function cardMenuItems({
  card,
  agentId,
  t,
  disabled,
  onOpenPanel,
  onOpen,
  onOpenAgent,
  onEdit,
  onStatus,
  packageName,
  onAddToPackage,
  onRemoveFromPackage,
  onAskPmToGroup,
  selectionCount = 0,
  onArchiveTask,
  onDelete,
}: {
  card: Card;
  agentId: string | null;
  t: ReturnType<typeof strings>;
  disabled: boolean;
  onOpenPanel(): void;
  onOpen(): void;
  onOpenAgent(agentId: string): void;
  onEdit(): void;
  onStatus(): void;
  // CUSTOM(packages)
  packageName?: string | null;
  onAddToPackage?(): void;
  onRemoveFromPackage?(): void;
  onAskPmToGroup?(): void;
  selectionCount?: number;
  /** CUSTOM(archive-task): passed only when the card can be archived (`canArchiveTask`). */
  onArchiveTask?(): void;
  /** CUSTOM(delete-task): always offered last, in any column, when the board passes it. */
  onDelete?(): void;
}): CardMenuItem[] {
  return [
    {
      id: "panel",
      label: t.openInPanel,
      icon: "PanelRight",
      onPress: onOpenPanel,
    },
    ...(card.workspaceId
      ? [
          {
            id: "workspace",
            label: t.openWorkspace,
            icon: "ArrowUpRight",
            onPress: onOpen,
          },
        ]
      : []),
    ...(agentId
      ? [
          {
            id: "agent",
            label: t.openAgent,
            icon: "Bot",
            onPress: () => onOpenAgent(agentId),
          },
        ]
      : []),
    ...(onAddToPackage
      ? [
          {
            id: "package-add",
            label: t.packages.addToPackage,
            icon: "PackagePlus",
            onPress: onAddToPackage,
          },
        ]
      : []),
    ...(packageName && onRemoveFromPackage
      ? [
          {
            id: "package-remove",
            label: t.packages.removeFromPackage,
            icon: "PackageMinus",
            onPress: onRemoveFromPackage,
          },
        ]
      : []),
    ...(selectionCount > 1 && onAskPmToGroup
      ? [
          {
            id: "package-ask",
            label: t.packages.askPmToGroup,
            icon: "Bot",
            onPress: onAskPmToGroup,
          },
        ]
      : []),
    { id: "edit", label: t.edit, icon: "FileText", onPress: onEdit },
    ...(!disabled && !card.binding && !card.archived
      ? [
          {
            id: "status",
            label: t.status,
            icon: "ArrowRightLeft",
            onPress: onStatus,
          },
        ]
      : []),
    ...(!disabled && onArchiveTask
      ? [
          {
            id: "archive-task",
            label: t.archiveTask,
            icon: "Archive",
            onPress: onArchiveTask,
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            id: "delete",
            label: t.deleteTask,
            icon: "Trash2",
            destructive: true,
            onPress: onDelete,
          },
        ]
      : []),
  ];
}
