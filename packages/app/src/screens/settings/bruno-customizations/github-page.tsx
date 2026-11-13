// CUSTOM(github-account): Settings > Bruno's Customizations > GitHub. Each host (daemon) picks
// the `gh` config directory, and so the GitHub account, its PR status and its agents use. The
// daemon's own setting wins over the GH_CONFIG_DIR its launcher inherited.

import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { GithubAccountStatusResponse } from "@getpaseo/protocol/messages";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { settingsStyles } from "@/styles/settings";

type AccountStatus = GithubAccountStatusResponse["payload"];

const SOURCE_LABEL: Record<AccountStatus["source"], string> = {
  settings: "this setting",
  launcher: "the launcher's GH_CONFIG_DIR",
  default: "gh's default (~/.config/gh)",
};

export function BrunoGithubPage({ serverId }: { serverId: string | null }) {
  if (!serverId)
    return <Text style={settingsStyles.rowHint}>Connect a host to set its GitHub account.</Text>;
  return <GithubAccountSettings serverId={serverId} />;
}

function GithubAccountSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.githubAccount === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  const savedDir = config?.github?.configDir ?? "";
  const [draft, setDraft] = useState(savedDir);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [tested, setTested] = useState<AccountStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "test" | "save" | null>(null);
  const draftRef = useRef(savedDir);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(savedDir);
  }, [savedDir]);

  const refresh = useCallback(async () => {
    if (!client || !supported) return;
    setBusy("refresh");
    setFailure(null);
    try {
      setStatus(await client.getGithubAccountStatus());
    } catch (error) {
      setFailure(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [client, supported]);

  useEffect(() => {
    if (isConnected) void refresh();
  }, [isConnected, refresh]);

  const handleTest = useCallback(async () => {
    if (!client) return;
    setBusy("test");
    setFailure(null);
    try {
      setTested(await client.getGithubAccountStatus(draftRef.current.trim()));
    } catch (error) {
      setFailure(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [client]);

  const handleSave = useCallback(async () => {
    setBusy("save");
    setFailure(null);
    try {
      await patchConfig({ github: { configDir: draftRef.current.trim() } });
      setTested(null);
    } catch (error) {
      setFailure(toErrorMessage(error));
      setBusy(null);
      return;
    }
    setBusy(null);
    await refresh();
  }, [patchConfig, refresh]);

  if (!isConnected) {
    return <Text style={settingsStyles.rowHint}>This host is offline.</Text>;
  }
  if (!supported) {
    return <Alert variant="info" description="Update this host to change its GitHub account." />;
  }

  const hasChanges = draft.trim() !== savedDir;
  return (
    <SettingsSection title="GitHub account">
      <SettingsCard testID="bruno-github-account">
        <SettingsRow label="Signed in as" hint={describeStatus(status)}>
          <Text style={settingsStyles.rowTitle}>
            {status?.login ?? (busy === "refresh" ? "…" : "Not signed in")}
          </Text>
          <Button variant="outline" size="sm" onPress={refresh} disabled={busy !== null}>
            Refresh
          </Button>
        </SettingsRow>
        <SettingsInput
          key={savedDir}
          label="gh config directory"
          hint="Empty uses the GH_CONFIG_DIR this host was launched with. A leading ~ is the home folder."
          initialValue={savedDir}
          onChangeText={setDraft}
          placeholder="~/.config/gh-personal"
          testID="bruno-github-config-dir"
        />
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowHint}>
              {tested
                ? describeTest(tested)
                : "Test checks the typed directory before you save it."}
            </Text>
          </View>
          <Button variant="outline" size="sm" onPress={handleTest} disabled={busy !== null}>
            Test
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={busy !== null || !hasChanges}
          >
            Save
          </Button>
        </View>
      </SettingsCard>
      {failure ? <Alert variant="error" description={failure} /> : null}
      <Text style={settingsStyles.rowHint}>
        The account is per host: each Paseo daemon uses its own. New agents and terminals pick up a
        change; running ones keep the old account until they are restarted.
      </Text>
    </SettingsSection>
  );
}

function describeStatus(status: AccountStatus | null): string {
  if (!status) return "Checking this host's gh account.";
  const dir = status.configDir ?? "~/.config/gh";
  const base = `Using ${dir}, from ${SOURCE_LABEL[status.source]}.`;
  return status.error ? `${base} ${status.error}` : base;
}

function describeTest(tested: AccountStatus): string {
  return tested.login ? `Signed in as ${tested.login}.` : (tested.error ?? "gh is not signed in.");
}
