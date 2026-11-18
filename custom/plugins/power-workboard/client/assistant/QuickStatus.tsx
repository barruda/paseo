// CUSTOM(assistant-quick): the "Projects Assistant status" row of the app's sidebar footer, and
// the popover to write a message to the assistant from any screen. The row shows the assistant's
// short ack of the newest message (ok, needs input, error, or pending); pressing it opens the
// assistant conversation at that message.
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useMutation,
  useQuery,
  useQueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  useRpc,
  type PluginHostProps,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import * as hostUi from "@getpaseo/plugin/client/ui";
import {
  assistantAskRpc,
  assistantQuickListRpc,
} from "../../shared/assistant-rpc";
import type { QuickAck, QuickMessage } from "../../shared/quick";
import { QUICK_MESSAGE_MAX } from "../../shared/quick";
import { usePaseoLanguage } from "../paseo-language";
import { queryClient } from "../query-client";
import type { Language } from "../strings";
import {
  conversationTarget,
  quickLabel,
  quickPollMs,
  quickVisual,
} from "./quick-format";

const strings = {
  en: {
    idle: "Projects Assistant",
    pending: "Waiting for the assistant…",
    newMessage: "New message to the Projects Assistant",
    placeholder: "Message the Projects Assistant",
    send: "Send",
    sending: "Sending…",
    recent: "Recent",
    none: "No messages yet.",
  },
  zh: {
    idle: "项目助手",
    pending: "正在等待助手…",
    newMessage: "给项目助手发送新消息",
    placeholder: "给项目助手发消息",
    send: "发送",
    sending: "发送中…",
    recent: "最近",
    none: "还没有消息。",
  },
} satisfies Record<Language, Record<string, string>>;

type Navigation = PluginSurfaceProps["navigation"];
/** The host adds `turnStartedAt` (app feature `turn-jump`); the pinned types predate it. */
type OpenAgent = (input: {
  agentId: string;
  turnStartedAt?: string;
  serverId?: string;
}) => void;
type WithNavigation = { navigation?: Navigation };

export interface QuickPopoverProps
  extends Partial<PluginHostProps>,
    WithNavigation {
  theme: PluginHostProps["theme"];
  close(): void;
}

// The pinned @getpaseo/plugin 0.10.0-beta.1 types have neither the sidebar item props nor
// SidebarRow; the running app provides both.
export interface QuickSidebarItemProps extends PluginHostProps, WithNavigation {
  openScreen(input: { screenId: string; params?: unknown }): void;
  openPopover(Component: ComponentType<QuickPopoverProps>): void;
  close?(): void;
}

interface SidebarRowLikeProps {
  onPress(): void;
  icon?: string | ComponentType<{ size: number; color: string }>;
  label?: string;
  active?: boolean;
  trailing?: ReactNode;
  id?: string;
}
const SidebarRow = (
  hostUi as unknown as { SidebarRow: ComponentType<SidebarRowLikeProps> }
).SidebarRow;

const LIST_KEY = ["power-workboard", "assistant", "quick", "list"] as const;

function openTarget(navigation: Navigation, item: QuickMessage): boolean {
  const target = conversationTarget(item);
  if (!target || !navigation) return false;
  (navigation.openAgent as OpenAgent)(target);
  return true;
}

function useQuickList() {
  const list = useRpc(assistantQuickListRpc);
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await list({})).items,
    refetchInterval: (query) => quickPollMs(query.state.data ?? []),
  });
}

function Status({
  theme,
  status,
  size = 16,
}: {
  theme: PluginHostProps["theme"];
  status: QuickMessage["status"];
  size?: number;
}) {
  const visual = quickVisual(status);
  return (
    <Icon name={visual.icon} size={size} color={theme.colors[visual.color]} />
  );
}

function SidebarItem(props: QuickSidebarItemProps) {
  const { theme, navigation, openPopover } = props;
  const s = strings[usePaseoLanguage()];
  const items = useQuickList().data ?? [];
  const newest = items[0] ?? null;
  const visual = quickVisual(newest?.status ?? "pending");
  const color = theme.colors[newest ? visual.color : "foregroundMuted"];
  const compose = () => openPopover(QuickAskPopover);
  const iconName = newest ? visual.icon : "MessageSquare";
  // A stable component per icon and color: the row re-parses its icon when it changes.
  const RowIcon = useMemo(
    () =>
      function QuickRowIcon({ size }: { size: number }) {
        return <Icon name={iconName} size={size} color={color} />;
      },
    [iconName, color],
  );
  return (
    <SidebarRow
      id="projects-assistant-status"
      icon={RowIcon}
      label={quickLabel(newest, s)}
      onPress={() => {
        if (!newest || !openTarget(navigation, newest)) compose();
      }}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.newMessage}
          onPress={compose}
          hitSlop={6}
        >
          <Icon
            name="MessageSquarePlus"
            size={16}
            color={theme.colors.foregroundMuted}
          />
        </Pressable>
      }
    />
  );
}

export function QuickStatusItem(props: QuickSidebarItemProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SidebarItem {...props} />
    </QueryClientProvider>
  );
}

function Popover({ theme, close, navigation, layout }: QuickPopoverProps) {
  const s = strings[usePaseoLanguage()];
  const ask = useRpc(assistantAskRpc);
  const client = useQueryClient();
  const items = (useQuickList().data ?? []).slice(0, 5);
  const [text, setText] = useState("");
  const [ack, setAck] = useState<QuickAck | null>(null);
  const send = useMutation({
    mutationFn: (value: string) =>
      ask({ text: value, source: "app", waitMs: 20_000 }),
    onSuccess: (result) => {
      setAck(result);
      setText("");
    },
    onSettled: () => client.invalidateQueries({ queryKey: LIST_KEY }),
  });
  const busy = send.isPending;
  const canSend = !busy && text.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    setAck(null);
    send.mutate(text.trim());
  };
  const open = (item: QuickMessage) => {
    if (openTarget(navigation, item)) close();
  };
  return (
    <View style={[styles.container, layout?.compact ? null : styles.wide]}>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={QUICK_MESSAGE_MAX}
        editable={!busy}
        placeholder={s.placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel={s.placeholder}
        onKeyPress={(event) => {
          // Web: Enter sends, Shift+Enter keeps the new line.
          const native = event.nativeEvent as unknown as {
            key: string;
            shiftKey?: boolean;
          };
          if (native.key === "Enter" && !native.shiftKey) {
            (
              event as unknown as { preventDefault?(): void }
            ).preventDefault?.();
            submit();
          }
        }}
        style={[
          styles.input,
          {
            color: theme.colors.foreground,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface0,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? s.sending : s.send}
        disabled={!canSend}
        onPress={submit}
        style={[
          styles.send,
          { backgroundColor: theme.colors.accent, opacity: canSend ? 1 : 0.5 },
        ]}
      >
        <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
          {busy ? s.sending : s.send}
        </Text>
      </Pressable>
      {send.isError ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger, fontSize: 13 }}
        >
          {send.error instanceof Error
            ? send.error.message
            : String(send.error)}
        </Text>
      ) : null}
      {ack ? (
        <View style={styles.line}>
          <Status theme={theme} status={ack.status} />
          <Text style={[styles.lineText, { color: theme.colors.foreground }]}>
            {ack.status === "pending" ? s.pending : ack.message}
          </Text>
        </View>
      ) : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {items.length ? s.recent : s.none}
      </Text>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          disabled={!conversationTarget(item) || !navigation}
          onPress={() => open(item)}
          style={({ pressed }) => [
            styles.line,
            {
              backgroundColor: pressed ? theme.colors.surface2 : "transparent",
            },
          ]}
        >
          <Status theme={theme} status={item.status} />
          <Text
            numberOfLines={2}
            style={[styles.lineText, { color: theme.colors.foreground }]}
          >
            {item.message ?? item.text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function QuickAskPopover(props: QuickPopoverProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <Popover {...props} />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, padding: 12 },
  // Anchored popover on wide layouts; the compact bottom sheet takes the full width.
  wide: { width: 320 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 72,
    fontSize: 13,
  },
  send: {
    alignSelf: "flex-end",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 8, padding: 4 },
  lineText: { flex: 1, fontSize: 13 },
});
