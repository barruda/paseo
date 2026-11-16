import { Redirect, type Href } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import SettingsScreen from "@/screens/settings-screen";
import { getLastSettingsPathname } from "@/navigation/settings-presentation";
import { buildSettingsSectionRoute } from "@/utils/host-routes";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  const isCompactLayout = useIsCompactFormFactor();

  if (!isCompactLayout) {
    // CUSTOM(settings-last-page): reopen the page the user was last on.
    return (
      <Redirect
        href={(getLastSettingsPathname() ?? buildSettingsSectionRoute("general")) as Href}
      />
    );
  }

  return <SettingsScreen view={ROOT_VIEW} />;
}
