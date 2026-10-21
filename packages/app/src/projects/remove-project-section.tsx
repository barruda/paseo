// CUSTOM(project-settings-remove): a Remove project button at the bottom of the project settings
// page. Upstream only offers it from the Projects sidebar's project menu, which Tasks mode never
// shows. It runs the same removal as that menu: archive the project's workspaces on each host and
// drop the project. Files on disk are not touched.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useToast } from "@/contexts/toast-context";
import {
  getCurrentProjectRemoveReadiness,
  removeProjectFromHosts,
} from "@/projects/project-remove";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { ProjectSummary } from "@/utils/projects";

export function RemoveProjectSection({
  project,
  projectName,
  onRemoved,
}: {
  project: ProjectSummary;
  projectName: string;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isRemoving, setIsRemoving] = useState(false);

  const handleRemove = useCallback(() => {
    if (isRemoving) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebar.project.confirmations.removeTitle"),
        message: t("sidebar.project.confirmations.removeMessage", { projectName }),
        confirmLabel: t("sidebar.project.confirmations.removeConfirm"),
        cancelLabel: t("sidebar.project.confirmations.cancel"),
        destructive: true,
      });
      if (!confirmed) return;

      const readiness = getCurrentProjectRemoveReadiness({ hosts: project.hosts });
      if (readiness.kind === "needs_host_update") {
        toast.error(t("sidebar.project.toasts.updateHostToRemove"));
        return;
      }

      setIsRemoving(true);
      try {
        const outcome = await removeProjectFromHosts({
          targets: readiness.targets,
          getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
        });
        if (outcome.kind === "host_disconnected") {
          toast.error(t("sidebar.project.toasts.hostDisconnected"));
          return;
        }
        if (outcome.kind === "failed") {
          toast.error(t("sidebar.project.toasts.removeFailed"));
          return;
        }
        onRemoved();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("sidebar.project.toasts.removeFailed"),
        );
      } finally {
        setIsRemoving(false);
      }
    })();
  }, [isRemoving, onRemoved, project.hosts, projectName, t, toast]);

  return (
    <SettingsSection title="Danger zone" testID="project-settings-remove-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("sidebar.project.actions.remove")}</Text>
            <Text style={settingsStyles.rowHint}>
              Archives its workspaces and takes it off the list. Files on disk are not changed.
            </Text>
          </View>
          <Button
            variant="destructive"
            size="sm"
            leftIcon={Trash2}
            loading={isRemoving}
            disabled={isRemoving}
            onPress={handleRemove}
            testID="project-settings-remove-button"
          >
            {t("sidebar.project.confirmations.removeConfirm")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}
