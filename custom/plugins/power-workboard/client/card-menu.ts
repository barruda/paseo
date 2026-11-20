// CUSTOM(task-panel): the card's context menu entries, kept pure so the behavior is testable.
import type { Card } from "../shared/model";
import type { strings } from "./strings";

export type CardMenuItem = {
  id: string;
  label: string;
  icon: string;
  onPress(): void;
};

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
  ];
}
