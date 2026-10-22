import { splitNodeContainsPane } from "@/components/split-container-focus";
import type { SplitNode } from "@/stores/workspace-layout-store";

// CUSTOM(explorer-toggle-tab-row): the pane whose tab row ends at the main column's top-right
// corner, where the Explorer toggle goes.
export function resolveTopRightPaneId(
  node: SplitNode,
  maximizedPaneId: string | null,
): string | null {
  if (maximizedPaneId && splitNodeContainsPane(node, maximizedPaneId)) return maximizedPaneId;
  if (node.kind === "pane") return node.pane.hidden === true ? null : node.pane.id;
  const children = node.group.children.filter((child) => !isHidden(child));
  const child = node.group.direction === "horizontal" ? children.at(-1) : children[0];
  return child ? resolveTopRightPaneId(child, null) : null;
}

function isHidden(node: SplitNode): boolean {
  if (node.kind === "pane") return node.pane.hidden === true;
  return node.group.children.every(isHidden);
}
