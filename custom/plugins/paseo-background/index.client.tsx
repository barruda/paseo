import { Platform, ScrollView } from "react-native";
import type { PluginClientContext, PluginSidebarItemProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { createController } from "./client/controller";
import { createSettingsScreen } from "./client/settings-screen";
import { language } from "./client/web";

export default function contribute(client: PluginClientContext) {
  if (Platform.OS !== "web") return () => {};
  const controller = createController(client);
  const Settings = createSettingsScreen(controller, client);
  function Screen(props: PluginSurfaceProps) {
    return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}><Settings {...props} /></ScrollView>;
  }
  const zh = language() === "zh";
  const title = zh ? "背景" : "Backgrounds";
  client.addSettingsScreen({ id: "background", title, icon: "Image", Component: Settings });
  client.addScreen({ id: "background", title, Component: Screen });
  function SidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
    return <SidebarRow icon="Image" active={currentScreen?.screenId === "background"} onPress={() => openScreen({ screenId: "background" })} />;
  }
  client.addSidebarFooterItem({ id: "background", title, Component: SidebarItem });
  client.addCommandCenterItem({ id: "open-background", title: zh ? "打开背景设置" : "Open background settings", icon: "Image", keywords: ["background", "wallpaper", "opacity", "背景", "透明度"], context: "global", onSelect: ({ openSettings }) => openSettings("background") });
  client.addCommandCenterItem({ id: "toggle-background", title: zh ? "切换背景开关" : "Toggle background", icon: "Image", keywords: ["background", "wallpaper", "背景"], context: "global", async onSelect() { await controller.toggle(); } });
  return () => controller.dispose();
}
