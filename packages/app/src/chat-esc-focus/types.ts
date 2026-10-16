import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface ChatEscFocusSurfaceProps {
  serverId: string;
  agentId: string;
  enabled: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}
