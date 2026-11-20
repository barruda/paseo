import { StyleSheet, View } from "react-native";
import { SettingsCard, SettingsSelect } from "@getpaseo/plugin/client/ui";
import {
  ACTIVITY_FILTERS,
  REQUEST_FILTERS,
  type BoardFilters,
} from "./filters";
import type { strings } from "./strings";
import type { PackageView } from "../shared/model";

export function FilterPanel({
  filters,
  onChange,
  packages,
  t,
}: {
  filters: BoardFilters;
  onChange(patch: Partial<BoardFilters>): void;
  packages: readonly PackageView[];
  t: ReturnType<typeof strings>;
}) {
  return (
    <View style={styles.panel}>
      <SettingsCard>
        <SettingsSelect
          label={t.packages.title}
          value={filters.packageId}
          options={[
            { value: "all", label: t.packages.allPackages },
            { value: "none", label: t.packages.noPackage },
            ...packages.map((pkg) => ({
              value: pkg.id,
              label: pkg.name,
            })),
          ]}
          onValueChange={(packageId: string) => onChange({ packageId })}
        />
        <SettingsSelect
          label={t.agentFilter}
          value={filters.activity}
          options={ACTIVITY_FILTERS.map((value) => ({
            value,
            label: value === "all" ? t.allStates : t.activity[value],
          }))}
          onValueChange={(activity: BoardFilters["activity"]) =>
            onChange({ activity })
          }
        />
        <SettingsSelect
          label={t.requestFilter}
          value={filters.changeRequest}
          options={REQUEST_FILTERS.map((value) => ({
            value,
            label: t.requestFilters[value],
          }))}
          onValueChange={(changeRequest: BoardFilters["changeRequest"]) =>
            onChange({ changeRequest })
          }
        />
      </SettingsCard>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { paddingHorizontal: 12, paddingTop: 8, maxWidth: 640, width: "100%" },
});
