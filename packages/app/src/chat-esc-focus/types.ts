import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface ChatEscFocusSurfaceProps {
  serverId: string;
  agentId: string;
  enabled: boolean;
  /** Whether the timeline is scrolled to (near) the bottom; reaching it focuses the composer. */
  isNearBottom: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}
