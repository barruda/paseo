// CUSTOM(idle-cleanup-period): Settings > Bruno's Customizations > Agents. How long an idle agent
// runtime lives before the host releases it. The on/off switch stays in Host > Agents.

import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { toErrorMessage } from "@/utils/error-messages";

const PERIOD_PRESETS = [15, 30, 60, 120, 240, 480, 1440];
const DEFAULT_PERIOD_MINUTES = 60;

function periodLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

export function BrunoAgentsPage({ serverId }: { serverId: string | null }) {
  if (!serverId) {
    return (
      <Text style={settingsStyles.rowHint}>Connect a host to set its idle agent release.</Text>
    );
  }
  return <IdlePeriodSettings serverId={serverId} />;
}

function IdlePeriodSettings({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "idleRuntimeCleanupPeriodSetting");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const minutes = config?.idleRuntimeCleanupMinutes ?? DEFAULT_PERIOD_MINUTES;
  const options = useMemo(
    () =>
      PERIOD_PRESETS.includes(minutes)
        ? PERIOD_PRESETS
        : [...PERIOD_PRESETS, minutes].sort((a, b) => a - b),
    [minutes],
  );

  const handleSelect = useCallback(
    async (next: number) => {
      setPending(true);
      setFailure(null);
      try {
        await patchConfig({ idleRuntimeCleanupMinutes: next });
      } catch (error) {
        setFailure(toErrorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [patchConfig],
  );

  if (!isConnected) return <Text style={settingsStyles.rowHint}>This host is offline.</Text>;
  if (!supported) {
    return (
      <Text style={settingsStyles.rowHint}>
        Update this host to set how long idle agents are kept.
      </Text>
    );
  }

  const releaseOff = config?.idleRuntimeCleanup === false;
  const hint = `Stops an idle agent's process after this long and keeps its conversation. The on/off switch is in Host > Agents.${
    releaseOff ? " Release is turned off on this host." : ""
  }`;
  return (
    <SettingsSection title="Agents">
      <SettingsCard testID="bruno-agents-idle-period">
        <SettingsRow label="Release idle agents after" hint={hint}>
          <DropdownMenu>
            <DropdownTrigger
              disabled={pending || !config}
              accessibilityRole="button"
              accessibilityLabel={`Release idle agents after: ${periodLabel(minutes)}`}
              testID="bruno-agents-idle-period-trigger"
            >
              {periodLabel(minutes)}
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={160}>
              {options.map((option) => (
                <PeriodOption
                  key={option}
                  minutes={option}
                  selected={option === minutes}
                  onSelect={handleSelect}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsRow>
      </SettingsCard>
      {failure ? <Text style={settingsStyles.rowError}>{failure}</Text> : null}
    </SettingsSection>
  );
}

function PeriodOption({
  minutes,
  selected,
  onSelect,
}: {
  minutes: number;
  selected: boolean;
  onSelect: (minutes: number) => void;
}) {
  const select = useCallback(() => onSelect(minutes), [onSelect, minutes]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {periodLabel(minutes)}
    </DropdownMenuItem>
  );
}
