// CUSTOM(jev-router): the chip beside the router icon when Jev started this session on another
// model or effort ("Model: Haiku 5.5 Effort: low", or "Effort: high"). Soft green like the selected
// Desk, it flashes when it appears and stays while the agent is still on Jev's pick. A click offers
// to run the first prompt again on what the user had selected, in a new session.

import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChangeFlash } from "@/composer/agent-controls/change-flash";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
} from "@/components/ui/dropdown-menu";
import { useSessionStore } from "@/stores/session-store";
import { describeRouteChip } from "./model";
import { selectJevRouteCardData as selectRouteCardData } from "./use-esc-restart";
import { useRestartAgent } from "./use-restart-agent";

export function JevRouteChip({ serverId, agentId }: { serverId: string; agentId: string }) {
  const rawCard = useSessionStore((state) =>
    selectRouteCardData(state.sessions[serverId], agentId),
  );
  const model = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.model);
  const effort = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.thinkingOptionId,
  );
  const chip = useMemo(
    () => describeRouteChip(rawCard, { model, effort }),
    [effort, model, rawCard],
  );
  const { restart, busy } = useRestartAgent(serverId, agentId);

  const handleRestart = useCallback(() => {
    if (!chip?.prompt) return;
    void restart({
      prompt: chip.prompt,
      model: chip.previousModelId,
      thinkingOptionId: chip.previousEffort,
    });
  }, [chip, restart]);

  if (!chip) return null;
  return (
    <ChangeFlash value={chip.label} flashOnMount overlayStyle={styles.flash}>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Jev: ${chip.label}. Run with ${chip.previous}`}
          testID="jev-route-chip"
        >
          <Text style={styles.label} numberOfLines={1}>
            {chip.label}
          </Text>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" minWidth={280} testID="jev-route-chip-menu">
          <DropdownMenuItem
            onSelect={handleRestart}
            disabled={!chip.prompt || busy}
            description={
              chip.prompt
                ? "Runs the first prompt again in a new session; this one is archived."
                : "The first prompt was too long to keep, so it can't run again."
            }
            testID="jev-route-chip-restart"
          >
            {`Run with ${chip.previous}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ChangeFlash>
  );
}

const triggerStyle: DropdownMenuTriggerProps["style"] = ({ hovered, open }) => [
  styles.chip,
  (hovered || open) && styles.chipActive,
];

const styles = StyleSheet.create((theme) => ({
  // The selected Desk's soft green (task-navigation/desk-screen.tsx), with lighter text.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    height: 26,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor:
      theme.colorScheme === "dark" ? "rgba(32, 116, 74, 0.2)" : "rgba(32, 116, 74, 0.12)",
  },
  chipActive: {
    backgroundColor:
      theme.colorScheme === "dark" ? "rgba(32, 116, 74, 0.32)" : "rgba(32, 116, 74, 0.2)",
  },
  label: {
    color: theme.colorScheme === "dark" ? "#e2f3e8" : "#2c7a52",
    fontSize: theme.fontSize.sm,
  },
  flash: {
    backgroundColor:
      theme.colorScheme === "dark" ? "rgba(120, 220, 160, 0.45)" : "rgba(32, 116, 74, 0.3)",
  },
}));
