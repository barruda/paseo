import type { ReactNode } from "react";
import type { ExplorerLockMode } from "@/explorer-lock/model"; // CUSTOM(explorer-lock): lockMode type
export interface ExplorerFrameProps {
  children: ReactNode;
  presentation: "overlay" | "dock";
  persistenceKey: string;
  isOpen: boolean;
  isWorkspaceActive: boolean;
  surfaceColor?: string;
  lockMode?: ExplorerLockMode; // CUSTOM(explorer-lock): which lock setting governs the width
}
