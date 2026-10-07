import { useMutation } from "@tanstack/react-query";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import {
  copyText,
  Icon,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { type ComponentRef, useCallback, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  runShellCommandRpc,
  sendShellInputRpc,
  type ShellCommandTimelineData,
  stopShellCommandRpc,
} from "../shared/shell-command";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function statusLabel(data: ShellCommandTimelineData): string {
  switch (data.status) {
    case "running":
      return "running…";
    case "stopped":
      return "stopped";
    case "completed":
      return data.durationMs === null ? "exit 0" : `exit 0 · ${formatDuration(data.durationMs)}`;
    case "failed": {
      if (data.error) return "failed";
      const exit = data.signal ? data.signal : `exit ${data.exitCode ?? "?"}`;
      return data.durationMs === null ? exit : `${exit} · ${formatDuration(data.durationMs)}`;
    }
  }
}

export function ShellCommandCard({
  agentId,
  item,
  theme,
}: PluginTimelineItemProps<ShellCommandTimelineData>) {
  const data = item.data;
  const toast = useToast();
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState("");
  const outputRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const stop = useRpc(stopShellCommandRpc);
  const sendInput = useRpc(sendShellInputRpc);
  const run = useRpc(runShellCommandRpc);
  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : String(error));
  const { mutate: stopById, isPending: stopping } = useMutation({
    mutationFn: (id: string) => stop({ id }),
    onError,
  });
  const { mutate: send } = useMutation({
    mutationFn: (input: { id: string; text: string }) => sendInput(input),
    onSuccess: ({ accepted }) => {
      if (!accepted) toast.error("The command has already finished");
    },
    onError,
  });
  const { mutate: rerun, isPending: rerunning } = useMutation({
    mutationFn: () => run({ agentId, cwd: data.cwd, command: data.command }),
    onError,
  });
  const runningId = data.status === "running" ? data.id : null;
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const copyOutput = useCallback(() => void copyText(data.output), [data.output]);
  const stopCommand = useCallback(() => {
    if (runningId) stopById(runningId);
  }, [runningId, stopById]);
  const submitDraft = useCallback(() => {
    if (!runningId) return;
    // Enter on an empty line still sends a newline: it answers "Press Enter to continue".
    send({ id: runningId, text: `${draft}\n` });
    setDraft("");
  }, [draft, runningId, send]);
  const sendCtrlC = useCallback(() => {
    if (runningId) send({ id: runningId, text: "\x03" });
  }, [runningId, send]);
  const sendCtrlD = useCallback(() => {
    if (runningId) send({ id: runningId, text: "\x04" });
  }, [runningId, send]);
  const runAgain = useCallback(() => rerun(), [rerun]);
  const followTail = useCallback(() => outputRef.current?.scrollToEnd({ animated: false }), []);

  const statusColor = {
    running: theme.colors.accent,
    completed: theme.colors.statusSuccess,
    failed: theme.colors.statusDanger,
    stopped: theme.colors.statusWarning,
  }[data.status];

  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
      tag: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
      },
      command: {
        flex: 1,
        color: theme.colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 13,
      },
      status: { color: statusColor, fontSize: 12 },
      body: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      meta: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: 10,
        paddingVertical: 6,
      },
      metaText: {
        flex: 1,
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontFamily: MONOSPACE,
      },
      action: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
      outputScroll: { maxHeight: 360 },
      output: {
        color: theme.colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
        lineHeight: 17,
        paddingHorizontal: 10,
        paddingBottom: 10,
      },
      muted: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        paddingHorizontal: 10,
        paddingBottom: 10,
      },
      error: {
        color: theme.colors.statusDanger,
        fontSize: 12,
        paddingHorizontal: 10,
        paddingBottom: 10,
      },
      inputRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      prompt: { color: theme.colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
      input: {
        flex: 1,
        minHeight: 28,
        paddingVertical: 4,
        color: theme.colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
      },
      key: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 4,
      },
      keyText: { color: theme.colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 11 },
    }),
    [theme, statusColor],
  );

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`Terminal command ${data.command}, ${statusLabel(data)}`}
      >
        <Icon name="SquareTerminal" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.tag}>Terminal</Text>
        <Text style={styles.command} numberOfLines={1}>
          $ {data.command}
        </Text>
        <Text style={styles.status}>{statusLabel(data)}</Text>
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <View style={styles.meta}>
            <Text style={styles.metaText} numberOfLines={1}>
              {data.cwd}
            </Text>
            {data.output ? (
              <Pressable onPress={copyOutput} hitSlop={8}>
                <Text style={styles.action}>Copy</Text>
              </Pressable>
            ) : null}
            {runningId ? (
              <Pressable onPress={stopCommand} disabled={stopping} hitSlop={8}>
                <Text style={styles.action}>Stop</Text>
              </Pressable>
            ) : (
              <Pressable onPress={runAgain} disabled={rerunning} hitSlop={8}>
                <Text style={styles.action}>Run again</Text>
              </Pressable>
            )}
          </View>
          {data.error ? <Text style={styles.error}>{data.error}</Text> : null}
          {data.truncated ? <Text style={styles.muted}>… earlier output truncated</Text> : null}
          {data.output ? (
            <ScrollView
              ref={outputRef}
              style={styles.outputScroll}
              nestedScrollEnabled
              onContentSizeChange={runningId ? followTail : undefined}
            >
              <Text style={styles.output} selectable>
                {data.output}
              </Text>
            </ScrollView>
          ) : (
            <Text style={styles.muted}>
              {data.status === "running" ? "No output yet" : "No output"}
            </Text>
          )}
          {runningId ? (
            <View style={styles.inputRow}>
              <Text style={styles.prompt}>›</Text>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={submitDraft}
                blurOnSubmit={false}
                placeholder={data.interactive ? "Type input, Enter to send" : "Send to stdin"}
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                accessibilityLabel={`Input for ${data.command}`}
              />
              <Pressable style={styles.key} onPress={sendCtrlC} accessibilityLabel="Send Ctrl-C">
                <Text style={styles.keyText}>^C</Text>
              </Pressable>
              <Pressable
                style={styles.key}
                onPress={sendCtrlD}
                accessibilityLabel="Send Ctrl-D (end of input)"
              >
                <Text style={styles.keyText}>^D</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
