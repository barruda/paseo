// CUSTOM(desk-docs): the Docs tab of the Explorer sidebar. See custom/CHANGES.md.
import { FileText } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { DeskDocsView } from "./view";

const ThemedFileText = withUnistyles(FileText);

// English only, like the other custom surfaces.
const docsPanelPresentation = {
  label: () => "Docs",
  subtitle: () => "Documents the agents wrote",
  tooltip: () => "Docs",
  icon: ThemedFileText,
} satisfies PanelPresentation;

export const docsPanelRegistration = definePanel("docs", {
  component: DeskDocsView,
  presentation: docsPanelPresentation,
});
