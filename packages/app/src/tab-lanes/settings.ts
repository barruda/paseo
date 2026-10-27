// CUSTOM(flexible-tabs): "Flexible tab movement" (Settings > Editor) turns the Desk tab rows on.
// Saved in the desktop settings file, so each launcher profile has its own; off by default.
import { useCallback } from "react";
import { getIsElectron } from "@/constants/platform";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";

export function useFlexibleTabMovement(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  available: boolean;
} {
  const { settings, updateSettings } = useDesktopSettings();
  const setEnabled = useCallback(
    (flexibleMovement: boolean) => void updateSettings({ tabs: { flexibleMovement } }),
    [updateSettings],
  );
  return {
    enabled: settings.tabs?.flexibleMovement === true,
    setEnabled,
    available: getIsElectron(),
  };
}
