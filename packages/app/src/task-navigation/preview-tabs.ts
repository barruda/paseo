// CUSTOM(desk-preview-tabs): "Preview tabs" (Settings > Editor). Off, a task click in Tasks mode
// opens its own tab instead of replacing the Desk's preview tab. Off by default.
import { queryClient } from "@/data/query-client";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { useSettings } from "@/hooks/use-settings";

/** Read outside React: the Desks store decides at open time. */
export function deskPreviewTabsEnabled(): boolean {
  const settings = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return settings?.deskPreviewTabs ?? DEFAULT_CLIENT_SETTINGS.deskPreviewTabs;
}

export function useDeskPreviewTabs(): boolean {
  return useSettings((settings) => settings.deskPreviewTabs);
}

/** With preview tabs off no tab reads as a preview, not even one left from before. */
export function useDeskPreviewTabId(previewTabId: string | null): string | null {
  return useDeskPreviewTabs() ? previewTabId : null;
}
