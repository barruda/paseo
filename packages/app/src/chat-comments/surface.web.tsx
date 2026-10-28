import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { Copy, MessageSquarePlus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { createAssistantSelectionClipboardContent } from "@/assistant-selection-copy/content.web";
import { Button } from "@/components/ui/button";
import { EditingTextInput } from "@/components/ui/text-input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  useContextMenu,
} from "@/components/ui/context-menu";
import type { Theme } from "@/styles/theme";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { formatChatComment } from "./model";
import { appendToChatComposer } from "./registry";

// CUSTOM(chat-comments): right-clicking text selected in a response offers Comment and Copy in
// place of the browser menu. Comment opens a box at the click; Enter puts the quoted excerpt and
// the comment at the end of this agent's composer. Selections outside responses (tool calls,
// user messages) keep the browser menu. English only, like the other custom surfaces.

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const BOX_WIDTH = 360;
const BOX_MARGIN = 12;
/** Rough height of the box, used only to keep it on screen near the bottom edge. */
const BOX_HEIGHT_ESTIMATE = 200;

interface CommentRequest {
  excerpt: string;
  x: number;
  y: number;
}

const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);
const ThemedCopy = withUnistyles(Copy);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const COMMENT_ICON = <ThemedMessageSquarePlus size={16} uniProps={iconColorMapping} />;
const COPY_ICON = <ThemedCopy size={16} uniProps={iconColorMapping} />;

function selectionInside(root: HTMLElement, selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed) return false;
  const { anchorNode, focusNode } = selection;
  return Boolean(anchorNode && focusNode && root.contains(anchorNode) && root.contains(focusNode));
}

/** Opens the menu at the right-click point each time a new request arrives. */
function MenuAnchor({ request }: { request: CommentRequest | null }): null {
  const menu = useContextMenu();
  const { setAnchorRect, setOpen } = menu;
  useEffect(() => {
    if (!request) return;
    setAnchorRect({ x: request.x, y: request.y, width: 0, height: 0 });
    setOpen(true);
  }, [request, setAnchorRect, setOpen]);
  return null;
}

function boxPosition(request: CommentRequest): CSSProperties {
  const left = Math.max(
    BOX_MARGIN,
    Math.min(request.x, window.innerWidth - BOX_WIDTH - BOX_MARGIN),
  );
  const top = Math.max(
    BOX_MARGIN,
    Math.min(request.y, window.innerHeight - BOX_HEIGHT_ESTIMATE - BOX_MARGIN),
  );
  return { position: "fixed", left, top, width: BOX_WIDTH, zIndex: 1000 };
}

function CommentBox({
  request,
  onSave,
  onClose,
}: {
  request: CommentRequest;
  onSave: (comment: string) => void;
  onClose: () => void;
}): ReactElement {
  const [comment, setComment] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose]);

  const save = useCallback(() => {
    if (comment.trim()) onSave(comment);
  }, [comment, onSave]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>) => {
      const { key, shiftKey } = event.nativeEvent;
      if (key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (key === "Enter" && !shiftKey) {
        event.preventDefault();
        save();
      }
    },
    [onClose, save],
  );

  return (
    <div ref={containerRef} style={boxPosition(request)} data-testid="chat-comment-box">
      <View style={styles.box}>
        <Text style={styles.excerpt} numberOfLines={3}>
          {request.excerpt}
        </Text>
        <ThemedTextInput
          testID="chat-comment-input"
          initialValue=""
          onChangeText={setComment}
          onKeyPress={handleKeyPress}
          placeholder="Comment on this part…"
          accessibilityLabel="Comment on the selected text"
          multiline
          autoFocus
          style={styles.input}
        />
        <View style={styles.actions}>
          <Text style={styles.hint}>Enter adds it to the message · Shift+Enter new line</Text>
          <Button variant="ghost" size="sm" onPress={onClose}>
            Cancel
          </Button>
          <Button size="sm" onPress={save} disabled={!comment.trim()} testID="chat-comment-save">
            Comment
          </Button>
        </View>
      </View>
    </div>
  );
}

export function ChatCommentSurface({
  serverId,
  agentId,
  enabled,
  children,
}: {
  serverId: string;
  agentId: string;
  enabled: boolean;
  children: ReactNode;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menuRequest, setMenuRequest] = useState<CommentRequest | null>(null);
  const [boxRequest, setBoxRequest] = useState<CommentRequest | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const handleContextMenu = (event: MouseEvent) => {
      const selection = window.getSelection();
      if (!selectionInside(root, selection)) return;
      // Only response text has content here; anything else keeps the browser menu.
      const excerpt = createAssistantSelectionClipboardContent(selection)?.plainText.trim();
      if (!excerpt) return;
      event.preventDefault();
      setBoxRequest(null);
      setMenuRequest({ excerpt, x: event.clientX, y: event.clientY });
    };
    root.addEventListener("contextmenu", handleContextMenu);
    return () => root.removeEventListener("contextmenu", handleContextMenu);
  }, [enabled]);

  const handleComment = useCallback(() => {
    if (menuRequest) setBoxRequest(menuRequest);
  }, [menuRequest]);

  const handleCopy = useCallback(() => {
    if (!menuRequest) return;
    void writeMarkdownToRichClipboard(
      menuRequest.excerpt,
      getDefaultMarkdownClipboardEnvironment(),
    );
  }, [menuRequest]);

  const closeBox = useCallback(() => setBoxRequest(null), []);

  const saveComment = useCallback(
    (comment: string) => {
      if (!boxRequest) return;
      const block = formatChatComment({ excerpt: boxRequest.excerpt, comment });
      if (appendToChatComposer(serverId, agentId, block)) {
        window.getSelection()?.removeAllRanges();
        setBoxRequest(null);
      }
    },
    [agentId, boxRequest, serverId],
  );

  return (
    <div ref={rootRef} style={DISPLAY_CONTENTS}>
      {children}
      {enabled ? (
        <ContextMenu>
          <MenuAnchor request={menuRequest} />
          <ContextMenuContent testID="chat-comment-menu">
            <ContextMenuItem
              leading={COMMENT_ICON}
              onSelect={handleComment}
              testID="chat-comment-menu-comment"
            >
              Comment
            </ContextMenuItem>
            <ContextMenuItem
              leading={COPY_ICON}
              onSelect={handleCopy}
              testID="chat-comment-menu-copy"
            >
              Copy
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : null}
      {boxRequest
        ? createPortal(
            <CommentBox request={boxRequest} onSave={saveComment} onClose={closeBox} />,
            document.body,
          )
        : null}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.md,
  },
  excerpt: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing[2],
  },
  input: {
    minHeight: 64,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    outlineWidth: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  hint: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
