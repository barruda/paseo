// CUSTOM(chat-file-actions): upstream 0.14 moved chat markdown to react-native-enriched-markdown and
// deleted this file. It stays as the fork's home for the file link pieces the customizations still
// render themselves:
// - `wrapWithFileLinkHover` wraps an already-rendered link with the hover card of actions (file links)
//   or the URL card (web links), for the markdown renderer's web link (`components/markdown/
//   renderers.web.tsx`).
// - `AssistantMarkdownCodeLink`, a standalone monospace file link (the "Logs:" row of
//   CUSTOM(shell-output-files)). Web only, like its callers.
import {
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, Text, type TextStyle } from "react-native";
import { useStableEvent } from "@/hooks/use-stable-event";
import { FileLinkHoverActions, UrlHoverActions } from "./hover-actions";
import type { AssistantFileLinkSource } from "./resolver";
import { useFileLink, type UseFileLinkResult } from "./use-file-link";

/**
 * The hover card for a link `useFileLink` already resolved, or null when the link is neither a
 * file nor a web URL (the caller then keeps its own tooltip).
 */
export function wrapWithFileLinkHover(
  source: AssistantFileLinkSource,
  link: Pick<UseFileLinkResult, "target" | "lookupQuery" | "externalUrl" | "open">,
  children: ReactNode,
): ReactElement | null {
  if (link.target || link.lookupQuery) {
    return (
      <FileLinkHoverActions
        source={source}
        target={link.target}
        lookupQuery={link.lookupQuery}
        open={link.open}
      >
        {children}
      </FileLinkHoverActions>
    );
  }
  if (link.externalUrl) {
    return <UrlHoverActions url={link.externalUrl}>{children}</UrlHoverActions>;
  }
  return null;
}

interface AssistantMarkdownCodeLinkProps {
  source: AssistantFileLinkSource;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
  children: ReactNode;
}

export function AssistantMarkdownCodeLink({
  source,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
  children,
}: AssistantMarkdownCodeLinkProps) {
  const link = useFileLink(source);
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useStableEvent(() => {
    setHovered(true);
    link.onHoverIn();
  });
  const handleHoverOut = useStableEvent(() => setHovered(false));
  const style = useMemo(
    () => [inheritedStyles, codeInlineStyle, linkStyle, hovered ? HOVERED_STYLE : null],
    [inheritedStyles, codeInlineStyle, linkStyle, hovered],
  );
  const anchor = (
    <a
      href={source.href}
      title={source.title}
      onClickCapture={preventAnchorNavigation}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      <Pressable
        accessibilityRole="link"
        onPress={link.onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
      >
        <Text style={style}>{children}</Text>
      </Pressable>
    </a>
  );
  return wrapWithFileLinkHover(source, link, anchor) ?? anchor;
}

const HOVERED_STYLE: TextStyle = { textDecorationLine: "underline" };

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}
