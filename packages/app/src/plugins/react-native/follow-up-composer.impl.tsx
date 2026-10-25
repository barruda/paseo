// CUSTOM(btw-actions): the chat composer's input (dictation, attach, send) for a plugin's own
// prompt, such as /btw's follow-up. Files upload to the daemon like the main composer's.
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FileText, Paperclip } from "lucide-react-native";
import type { FollowUpComposerProps } from "@getpaseo/plugin/client/react-native";
import type { ComposerAttachment } from "@/attachments/types";
import { getFileTypeLabel } from "@/attachments/file-types";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { uploadFileAttachments } from "@/composer/actions";
import {
  MessageInput,
  type AttachmentMenuItem,
  type ComposerKeyPressEvent,
} from "@/composer/input/input";
import type { MessagePayload, TextReplacement } from "@/composer/types";
import { useToast } from "@/contexts/toast-context";
import { useFilePicker } from "@/hooks/use-file-picker";
import { useIsDictationReady } from "@/hooks/use-is-dictation-ready";
import {
  useHostRuntimeAgentDirectoryStatus,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

type FileAttachment = Extract<ComposerAttachment, { kind: "file" }>;

const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedFileText = withUnistyles(FileText);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function FollowUpComposer({
  serverId,
  agentId,
  placeholder,
  disabled = false,
  onSubmit,
  onCancel,
}: FollowUpComposerProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const agentDirectoryStatus = useHostRuntimeAgentDirectoryStatus(serverId);
  const isDictationReady = useIsDictationReady({ serverId, isConnected, agentDirectoryStatus });
  const cwd = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.cwd ?? "");
  const { pickFiles } = useFilePicker();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const replacementCount = useRef(0);
  const [textReplacement, setTextReplacement] = useState<TextReplacement>({
    key: "initial",
    text: "",
  });

  const handlePickFile = useCallback(async () => {
    if (!client) return;
    try {
      const picked = await pickFiles();
      if (!picked) return;
      setIsUploading(true);
      const uploaded = await uploadFileAttachments({ client, files: picked });
      setFiles((current) => [...current, ...uploaded]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("composer.errors.uploadFailed"));
    } finally {
      setIsUploading(false);
    }
  }, [client, pickFiles, t, toast]);

  const attachmentMenuItems = useMemo<AttachmentMenuItem[]>(
    () => [
      {
        id: "file",
        label: t("composer.attachments.addFile"),
        icon: <ThemedPaperclip size={ICON_SIZE.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          void handlePickFile();
        },
      },
    ],
    [handlePickFile, t],
  );

  const handleSubmit = useCallback(
    (payload: MessagePayload) => {
      const question = payload.text.trim();
      if (!question) return;
      void onSubmit({
        text: question,
        files: files.map((file) => ({
          fileName: file.attachment.fileName,
          mimeType: file.attachment.mimeType,
          path: file.attachment.path,
        })),
      });
      setText("");
      setFiles([]);
      replacementCount.current += 1;
      setTextReplacement({ key: `sent-${replacementCount.current}`, text: "" });
    },
    [files, onSubmit],
  );

  const handleKeyPress = useCallback(
    (event: ComposerKeyPressEvent) => {
      if (event.key !== "Escape" || !onCancel) return false;
      event.preventDefault();
      onCancel();
      return true;
    },
    [onCancel],
  );

  const removeFile = useCallback(
    (id: string) => setFiles((current) => current.filter((file) => file.attachment.id !== id)),
    [],
  );
  const attachmentSlot = useMemo(
    () =>
      files.length > 0 ? (
        <View style={styles.tray}>
          {files.map((file) => (
            <FilePill key={file.attachment.id} file={file} onRemove={removeFile} />
          ))}
        </View>
      ) : null,
    [files, removeFile],
  );

  return (
    <MessageInput
      value={text}
      onChangeText={setText}
      onSubmit={handleSubmit}
      attachments={files}
      cwd={cwd}
      attachmentMenuItems={attachmentMenuItems}
      client={client}
      isReadyForDictation={isDictationReady}
      placeholder={placeholder}
      autoFocus
      autoFocusKey={`follow-up:${serverId}:${agentId}`}
      disabled={disabled}
      isSubmitLoading={isUploading}
      defaultSendBehavior="interrupt"
      onKeyPress={handleKeyPress}
      attachmentSlot={attachmentSlot}
      textReplacement={textReplacement}
    />
  );
}

const fileIcon = <ThemedFileText size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />;

function noop() {}

function FilePill({ file, onRemove }: { file: FileAttachment; onRemove(id: string): void }) {
  const { t } = useTranslation();
  const { id, fileName } = file.attachment;
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);
  return (
    <AttachmentPill
      onOpen={noop}
      onRemove={handleRemove}
      openAccessibilityLabel={fileName}
      removeAccessibilityLabel={t("composer.attachments.removeFile")}
    >
      <AttachmentLabel
        icon={fileIcon}
        title={fileName}
        subtitle={getFileTypeLabel(fileName) ?? t("message.attachments.file")}
      />
    </AttachmentPill>
  );
}

const styles = StyleSheet.create((theme) => ({
  tray: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
