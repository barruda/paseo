// CUSTOM(explorer-lock): reads "Keep the right sidebar open or closed" (Settings > Bruno's
// Customizations > Tabs). On by default in Tasks mode, off in the workspace view.
import { queryClient } from "@/data/query-client";
import { useAppSettings } from "@/hooks/use-settings";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { isExplorerLockOn, type ExplorerLockMode } from "./model";

/** Read outside React: opening the Project Manager decides at click time. */
export function explorerLockEnabled(mode: ExplorerLockMode): boolean {
  const settings = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return isExplorerLockOn(settings ?? DEFAULT_CLIENT_SETTINGS, mode);
}

/** The switch, and whether the settings have loaded (before that it holds the default). */
export function useExplorerLockSetting(mode: ExplorerLockMode): {
  lockOn: boolean;
  settingsLoaded: boolean;
} {
  const { settings, isLoading } = useAppSettings();
  return { lockOn: isExplorerLockOn(settings, mode), settingsLoaded: !isLoading };
}
