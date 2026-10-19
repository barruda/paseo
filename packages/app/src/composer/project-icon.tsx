// CUSTOM(composer-project-icon): identify the current project beside the context meter.
// When the composer can switch projects, the icon opens the same list as the up-arrow cycle.
import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelPickerProjectOption, ModelPickerProjectSource } from "@/model-picker/project";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { useSessionStore } from "@/stores/session-store";
import { resolveComposerProjectIdentity } from "./project-icon-model";

interface ComposerProjectIconProps {
  serverId: string;
  agentId: string;
  workspaceId: string | null | undefined;
  size: number;
  projectSource?: ModelPickerProjectSource | null;
  onMenuClose?: () => void;
}

export function ComposerProjectIcon({
  serverId,
  agentId,
  workspaceId,
  size,
  projectSource = null,
  onMenuClose,
}: ComposerProjectIconProps) {
  const projectId = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const resolvedWorkspaceId = workspaceId ?? session?.agents.get(agentId)?.workspaceId;
    if (!session || !resolvedWorkspaceId) return null;
    return session.workspaces.get(resolvedWorkspaceId)?.projectId ?? null;
  });
  const serverIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(serverIds);
  const identity = useMemo(
    () => resolveComposerProjectIdentity({ serverId, projectId, projects }),
    [serverId, projectId, projects],
  );
  const targets = useMemo(() => (identity ? [identity.target] : []), [identity]);
  const icons = useProjectIcons({ projects: targets });
  if (!identity) return null;

  const icon = (
    <ProjectIconView
      iconDataUri={icons.get(identity.target.projectViewKey) ?? null}
      initial={identity.initial}
      projectViewKey={identity.target.projectViewKey}
      size={size}
      textStyle={styles.initial}
    />
  );

  if (!projectSource) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <View
            style={styles.slot}
            accessibilityLabel={identity.name}
            testID="composer-project-icon"
          >
            {icon}
          </View>
        </TooltipTrigger>
        <TooltipContent side="top">
          <Text style={styles.name}>{identity.name}</Text>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <ComposerProjectMenu name={identity.name} source={projectSource} onClose={onMenuClose}>
      {icon}
    </ComposerProjectMenu>
  );
}

interface ComposerProjectMenuProps {
  children: ReactNode;
  name: string;
  source: ModelPickerProjectSource;
  onClose?: () => void;
}

function ComposerProjectMenu({ children, name, source, onClose }: ComposerProjectMenuProps) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose?.();
    },
    [onClose],
  );

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <View style={styles.slot} collapsable={false}>
            <DropdownMenuTrigger
              accessibilityLabel={name}
              accessibilityRole="button"
              style={styles.trigger}
              testID="composer-project-icon"
            >
              {children}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top">
          <Text style={styles.name}>{name}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" minWidth={220} side="top" testID="composer-project-menu">
        {source.options.map((option) => (
          <ProjectMenuItem
            key={option.id}
            option={option}
            selected={option.id === source.selectedId}
            onPick={source.select}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProjectMenuItemProps {
  option: ModelPickerProjectOption;
  selected: boolean;
  onPick: (id: string) => void;
}

function ProjectMenuItem({ option, selected, onPick }: ProjectMenuItemProps) {
  const handleSelect = useCallback(() => {
    if (!selected) onPick(option.id);
  }, [option.id, onPick, selected]);

  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      onSelect={handleSelect}
      testID={`composer-project-menu-item-${option.id}`}
    >
      {option.label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  slot: { width: 28, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  trigger: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  initial: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  name: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
