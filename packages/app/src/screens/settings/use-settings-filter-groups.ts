// CUSTOM(settings-filter): builds the searchable sidebar groups, resolving each page's content terms
// in the current language (memoized per language).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import type { SearchableGroup, SearchableItem } from "@/screens/settings/settings-search";
import {
  SETTINGS_SEARCH_INDEX,
  resolveSearchTerms,
} from "@/screens/settings/settings-search-index";

export interface FilterSourceItem<Id extends string, Icon> {
  id: Id;
  label: string;
  icon: Icon;
}

export type FilterItem<Icon> = SearchableItem & { icon: Icon };

export function useSettingsFilterGroups<Icon>(
  appItems: FilterSourceItem<SettingsSectionSlug, Icon>[],
  brunoItems: FilterSourceItem<SettingsSectionSlug, Icon>[],
  hostItems: FilterSourceItem<HostSectionSlug, Icon>[] | null,
): SearchableGroup<FilterItem<Icon>>[] {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const termsById = useMemo(() => {
    void language; // the resolved strings change with the language
    const translate = (key: string, options: { returnObjects: true }): unknown => t(key, options);
    const map = new Map<string, string[]>();
    for (const [id, entry] of Object.entries(SETTINGS_SEARCH_INDEX)) {
      map.set(id, resolveSearchTerms(entry, translate));
    }
    return map;
  }, [t, language]);

  return useMemo(() => {
    const toItem = (item: FilterSourceItem<string, Icon>): FilterItem<Icon> => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      terms: termsById.get(item.id) ?? [],
    });
    const groups: SearchableGroup<FilterItem<Icon>>[] = [
      { id: "app", label: t("settings.groups.app"), items: appItems.map(toItem) },
      { id: "bruno", label: "Bruno's Customizations", items: brunoItems.map(toItem) },
    ];
    if (hostItems) {
      groups.push({ id: "host", label: t("settings.groups.host"), items: hostItems.map(toItem) });
    }
    return groups;
  }, [appItems, brunoItems, hostItems, t, termsById]);
}
