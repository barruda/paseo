// CUSTOM(telus-sync): checklist, preview, history and confirmed rollback.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  CATEGORY_IDS,
  CATEGORY_INFO,
  type CategoryId,
  type HistoryEntry,
  type PreviewCategory,
  type PreviewItem,
  type RunResult,
  type SyncStatus,
} from "../shared/model";
import {
  telusSyncHistoryRpc,
  telusSyncPreviewRpc,
  telusSyncRollbackRpc,
  telusSyncRunRpc,
  telusSyncStatusRpc,
} from "../shared/rpc";

const ALL_CATEGORIES = [...CATEGORY_IDS];

function allSelected(): Record<CategoryId, boolean> {
  return Object.fromEntries(ALL_CATEGORIES.map((id) => [id, true])) as Record<
    CategoryId,
    boolean
  >;
}

function statusGlyph(status: PreviewItem["status"]): string {
  if (status === "new") return "+";
  if (status === "changed") return "~";
  if (status === "same") return "=";
  return "!";
}

function describeHistory(entry: HistoryEntry): string {
  const when = new Date(entry.at);
  const date = Number.isNaN(when.getTime()) ? entry.at : when.toLocaleString();
  const categories =
    entry.categories.map((id) => CATEGORY_INFO[id].title).join(", ") || "—";
  const outcome = entry.failed ? "failed" : `${entry.copied} copied`;
  const rolledBack = entry.rolledBackAt ? " · rolled back" : "";
  return `${date} · ${outcome}${rolledBack} · ${categories}`;
}

export function TelusSyncSettingsScreen(props: PluginSurfaceProps) {
  const loadStatus = useRpc(telusSyncStatusRpc);
  const loadPreview = useRpc(telusSyncPreviewRpc);
  const loadHistory = useRpc(telusSyncHistoryRpc);
  const runSync = useRpc(telusSyncRunRpc);
  const rollback = useRpc(telusSyncRollbackRpc);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [preview, setPreview] = useState<PreviewCategory[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] =
    useState<Record<CategoryId, boolean>>(allSelected);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await loadStatus({});
      setStatus(next);
      if (!next.available) return;
      const nextHistory = await loadHistory({});
      setHistory(nextHistory.entries);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [loadStatus, loadHistory]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (!cancelled) setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const chosen = useMemo(
    () => ALL_CATEGORIES.filter((id) => selected[id]),
    [selected],
  );

  // The preview follows the checklist: only checked categories are computed, and toggling one
  // refreshes it before the user presses the button.
  useEffect(() => {
    if (!status?.available || !chosen.length) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadPreview({ categories: chosen });
        if (cancelled) return;
        setPreview(next.categories);
        setError(null);
      } catch (failure) {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status?.available, chosen, loadPreview]);

  const refreshAfterRun = useCallback(async () => {
    try {
      const [nextPreview, nextHistory] = await Promise.all([
        chosen.length
          ? loadPreview({ categories: chosen })
          : Promise.resolve({ categories: [] }),
        loadHistory({}),
      ]);
      setPreview(nextPreview.categories);
      setHistory(nextHistory.entries);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [chosen, loadPreview, loadHistory]);

  const toggle = useCallback((id: CategoryId, value: boolean) => {
    setSelected((current) => ({ ...current, [id]: value }));
  }, []);

  const sync = useCallback(async () => {
    if (!chosen.length) {
      setError("Select at least one category.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await runSync({ categories: chosen });
      setResult(next);
      if (next.error) setError(next.error);
      await refreshAfterRun();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [chosen, runSync, refreshAfterRun]);

  const restore = useCallback(async () => {
    if (!confirmRollback) return;
    setBusy(true);
    setError(null);
    try {
      const next = await rollback({ backupId: confirmRollback });
      setResult(next);
      if (next.error) setError(next.error);
      setConfirmRollback(null);
      await refreshAfterRun();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [confirmRollback, rollback, refreshAfterRun]);

  const muted = useMemo(
    () => ({ color: props.theme.colors.foregroundMuted }),
    [props.theme],
  );
  const normal = useMemo(
    () => ({ color: props.theme.colors.foreground }),
    [props.theme],
  );

  if (busy && !status) return <Text style={normal}>Loading…</Text>;

  if (status && !status.available)
    return (
      <SettingsSection title="Sincronizar com Paseo Telus">
        <Text style={normal}>{status.reason}</Text>
      </SettingsSection>
    );

  return (
    <>
      <SettingsSection
        title="Sincronizar com Paseo Telus"
        info="Copies UX and plugin configuration from this Paseo Personal daemon to the Paseo Telus install on the same machine. Nothing runs on its own: the sync only happens when you press the button, and only for the categories you leave checked. Before writing, it backs up every Telus file it will overwrite."
      >
        <SettingsCard>
          {ALL_CATEGORIES.map((id) => (
            <SettingsSwitch
              key={id}
              label={CATEGORY_INFO[id].title}
              hint={CATEGORY_INFO[id].description}
              value={selected[id]}
              onValueChange={(value) => toggle(id, value)}
              disabled={busy}
            />
          ))}
          <SettingsAction
            label={
              chosen.length
                ? `${chosen.length} of ${ALL_CATEGORIES.length} categories selected`
                : "Choose at least one category"
            }
            hint={`Source: ${status?.sourceHome ?? ""} → target: ${status?.targetHome ?? ""}`}
            actionLabel={busy ? "Working…" : "Sync now"}
            onPress={() => void sync()}
            disabled={busy || !chosen.length}
            error={error}
          />
        </SettingsCard>
        <Text style={muted}>
          Never copied: credentials (local-credential, daemon-keypair.json,
          tokens, server-id, cli-client-id), agent and provider definitions,
          agent profiles, and anything under agents/, projects/, schedules/ or
          runtime/. From config.json only the features block and the plugin list
          travel. Theme, fonts, sidebar layout and keyboard shortcuts live in
          the client&apos;s own Electron storage (localStorage), which cannot be
          written safely while the other app is open; set those by hand on the
          Telus side.
        </Text>
      </SettingsSection>

      <SettingsSection
        title="Preview"
        info="What the checked categories would change right now."
      >
        <SettingsCard>
          {preview.map((category) => (
            <SettingsRow
              key={category.category}
              label={`${category.title}: ${category.changed} to change, ${category.same} already the same${category.unavailable ? `, ${category.unavailable} unavailable` : ""}`}
            >
              {category.items.map((item) => (
                <Text
                  key={item.label}
                  style={item.status === "same" ? muted : normal}
                >
                  {statusGlyph(item.status)} {item.label}
                  {item.detail ? ` — ${item.detail}` : ""}
                </Text>
              ))}
              {category.notes.map((note) => (
                <Text key={note} style={muted}>
                  {note}
                </Text>
              ))}
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>

      {result ? (
        <SettingsSection title={result.ok ? "Last run" : "Last run failed"}>
          <SettingsCard>
            <SettingsRow
              label={
                result.backupId ? `Backup ${result.backupId}` : "No backup"
              }
            >
              <Text style={normal}>
                {result.copied} copied, {result.same} already the same
                {result.skipped ? `, ${result.skipped} unavailable` : ""}.
              </Text>
              {result.backupPath ? (
                <Text style={muted}>{result.backupPath}</Text>
              ) : null}
              {result.error ? <Text style={normal}>{result.error}</Text> : null}
              {result.warnings.map((warning) => (
                <Text key={warning} style={muted}>
                  {warning}
                </Text>
              ))}
              {result.apply.map((note) => (
                <Text key={note} style={normal}>
                  {note}
                </Text>
              ))}
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="History"
        info="The five newest syncs. A rollback restores the Telus files captured by that sync's backup; it does not restart any daemon."
      >
        <SettingsCard>
          {history.length ? (
            history.map((entry) => (
              <SettingsAction
                key={entry.id}
                label={describeHistory(entry)}
                actionLabel={entry.rolledBackAt ? "Rolled back" : "Rollback"}
                onPress={() => setConfirmRollback(entry.id)}
                disabled={busy || Boolean(entry.rolledBackAt)}
              />
            ))
          ) : (
            <SettingsRow label="No syncs yet">
              <Text style={muted}>
                The first backup appears here after a sync.
              </Text>
            </SettingsRow>
          )}
          {confirmRollback ? (
            <>
              <SettingsRow label={`Roll back ${confirmRollback}?`}>
                <Text style={normal}>
                  Every Telus file in that backup is restored, overwriting the
                  current Telus state.
                </Text>
              </SettingsRow>
              <SettingsAction
                label="Restore the files now"
                actionLabel={busy ? "Working…" : "Confirm rollback"}
                onPress={() => void restore()}
                disabled={busy}
                error={error}
              />
              <SettingsAction
                label="Keep the current state"
                actionLabel="Cancel"
                onPress={() => setConfirmRollback(null)}
                disabled={busy}
              />
            </>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
