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
// CUSTOM(idle-closed-tab)
const CLOSED_TAB_PRESETS = [5, 10, 15, 30, 60, 120];
const DEFAULT_CLOSED_TAB_MINUTES = 15;
// CUSTOM(auto-archive-closed): days, 0 is off.
const AUTO_ARCHIVE_PRESETS = [0, 1, 2, 3, 7, 14, 30];
const DEFAULT_AUTO_ARCHIVE_DAYS = 2;

function daysLabel(days: number): string {
  if (days === 0) return "Off";
  return days === 1 ? "1 day" : `${days} days`;
}

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
  // CUSTOM(idle-closed-tab)
  const supportsClosedTab = useHostFeature(serverId, "idleRuntimeCleanupClosedTabSetting");
  // CUSTOM(auto-archive-closed)
  const supportsAutoArchive = useHostFeature(serverId, "autoArchiveClosedSetting");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const saveOpenTab = useCallback(
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
  // CUSTOM(idle-closed-tab)
  const saveClosedTab = useCallback(
    async (next: number) => {
      setPending(true);
      setFailure(null);
      try {
        await patchConfig({ idleRuntimeCleanupClosedTabMinutes: next });
      } catch (error) {
        setFailure(toErrorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [patchConfig],
  );

  // CUSTOM(auto-archive-closed)
  const saveAutoArchive = useCallback(
    async (next: number) => {
      setPending(true);
      setFailure(null);
      try {
        await patchConfig({ autoArchiveClosedDays: next });
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
  const offNote = releaseOff ? " Release is turned off on this host." : "";
  return (
    <SettingsSection title="Agents">
      <SettingsCard testID="bruno-agents-idle-period">
        <PeriodRow
          label="Release idle agents with an open tab after"
          hint={`Stops an idle agent's process after this long and keeps its conversation. The on/off switch is in Host > Agents.${offNote}`}
          minutes={config?.idleRuntimeCleanupMinutes ?? DEFAULT_PERIOD_MINUTES}
          presets={PERIOD_PRESETS}
          disabled={pending || !config}
          onSelect={saveOpenTab}
          testID="bruno-agents-idle-period-trigger"
        />
        {supportsClosedTab ? (
          <PeriodRow
            label="Release idle agents with no open tab after"
            hint={`No tab open on any device. In normal mode, closing a tab already archives the agent, so this mostly applies to Tasks mode.${offNote}`}
            minutes={config?.idleRuntimeCleanupClosedTabMinutes ?? DEFAULT_CLOSED_TAB_MINUTES}
            presets={CLOSED_TAB_PRESETS}
            disabled={pending || !config}
            onSelect={saveClosedTab}
            testID="bruno-agents-idle-closed-tab-trigger"
          />
        ) : null}
        {supportsAutoArchive ? (
          <PeriodRow
            label="Auto-archive closed sessions after"
            hint="Archives a session with no running process and no open tab after this long without activity. Archived sessions stay in History > Archived."
            minutes={config?.autoArchiveClosedDays ?? DEFAULT_AUTO_ARCHIVE_DAYS}
            presets={AUTO_ARCHIVE_PRESETS}
            format={daysLabel}
            disabled={pending || !config}
            onSelect={saveAutoArchive}
            testID="bruno-agents-auto-archive-trigger"
          />
        ) : null}
      </SettingsCard>
      {failure ? <Text style={settingsStyles.rowError}>{failure}</Text> : null}
    </SettingsSection>
  );
}

function PeriodRow({
  label,
  hint,
  minutes,
  presets,
  disabled,
  onSelect,
  testID,
  format = periodLabel,
}: {
  label: string;
  hint: string;
  minutes: number;
  presets: readonly number[];
  disabled: boolean;
  onSelect: (minutes: number) => void;
  testID: string;
  format?: (value: number) => string;
}) {
  const options = useMemo(
    () => (presets.includes(minutes) ? presets : [...presets, minutes].sort((a, b) => a - b)),
    [presets, minutes],
  );
  return (
    <SettingsRow label={label} hint={hint}>
      <DropdownMenu>
        <DropdownTrigger
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${format(minutes)}`}
          testID={testID}
        >
          {format(minutes)}
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={160}>
          {options.map((option) => (
            <PeriodOption
              key={option}
              minutes={option}
              label={format(option)}
              selected={option === minutes}
              onSelect={onSelect}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  );
}

function PeriodOption({
  minutes,
  label,
  selected,
  onSelect,
}: {
  minutes: number;
  label: string;
  selected: boolean;
  onSelect: (minutes: number) => void;
}) {
  const select = useCallback(() => onSelect(minutes), [onSelect, minutes]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {label}
    </DropdownMenuItem>
  );
}
