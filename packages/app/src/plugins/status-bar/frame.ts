// CUSTOM(status-bar)
import { createContext, useContext } from "react";
import type { View } from "react-native";

/** What the host tells the StatusBarItem kit component about the status bar item it renders in. */
export interface StatusBarItemFrame {
  placement: "bar" | "drawer";
  title: string;
  testID: string;
  /** An entry calls this before its `onPress`, so a popover that press opens anchors to it. */
  anchorTo: (node: View | null) => void;
  /** Entries offer themselves on mount, so a popover opened without a press anchors to one. */
  offerAnchor: (node: View | null) => void;
  releaseAnchor: (node: View | null) => void;
}

export const StatusBarItemFrameContext = createContext<StatusBarItemFrame | null>(null);

export function useStatusBarItemFrame(componentName: string): StatusBarItemFrame {
  const frame = useContext(StatusBarItemFrameContext);
  if (!frame) throw new Error(`${componentName} must render inside a status bar item`);
  return frame;
}
