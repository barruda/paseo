// CUSTOM(reading-modes): Newspaper and Cards, drawn over the chat. The chat stays mounted
// underneath, so opening a turn scrolls the real transcript instead of rebuilding it.
// Newspaper flows prompts and final answers through the shared column scroller.
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ColumnScroller,
  LoadingOlder,
  color,
  overlayScrollerStyle,
  useFollowEnd,
  useNearStartLoader,
  useScrollerStyle,
} from "./column-scroller.web";
import type { ReadingTurn } from "./model";
import type { ReadingOverviewProps } from "./overview";

// About 65 characters of chat text per line.
const COLUMN_WIDTH = 460;
const CARD_BODY_MAX_HEIGHT = 340;
const PROMPT_LINES_NEWSPAPER = 8;
const PROMPT_LINES_CARD = 4;
const cardsScrollerStyle: CSSProperties = { ...overlayScrollerStyle, overflowY: "auto" };

const promptStyle: CSSProperties = {
  breakInside: "avoid",
  cursor: "pointer",
  background: color.surface2,
  color: color.foreground,
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  marginBottom: 8,
};
const metaStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  fontSize: 12,
  color: color.extraMuted,
  breakInside: "avoid",
};
const linkButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: color.muted,
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};
const olderHistoryStyle: CSSProperties = {
  fontSize: 12,
  color: color.extraMuted,
  marginBottom: 16,
  breakInside: "avoid",
};
const newspaperTurnStyle: CSSProperties = { marginBottom: 28 };
const cardsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
  gap: 16,
  alignItems: "start",
};
const cardStyle: CSSProperties = {
  border: `1px solid ${color.border}`,
  borderRadius: 12,
  background: color.surface1,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};
const cardBodyStyle: CSSProperties = {
  position: "relative",
  maxHeight: CARD_BODY_MAX_HEIGHT,
  overflow: "hidden",
};
const cardBodyExpandedStyle: CSSProperties = { position: "relative" };
const cardFadeStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 64,
  background: `linear-gradient(to bottom, transparent, ${color.surface1})`,
  pointerEvents: "none",
};

function clampLines(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}
const promptClampStyle = {
  [PROMPT_LINES_NEWSPAPER]: clampLines(PROMPT_LINES_NEWSPAPER),
  [PROMPT_LINES_CARD]: clampLines(PROMPT_LINES_CARD),
};

function stepsLabel(count: number): string {
  return count === 1 ? "1 step hidden" : `${count} steps hidden`;
}

interface TurnProps {
  turn: ReadingTurn;
  onOpenTurn: ReadingOverviewProps["onOpenTurn"];
}

function useOpenTurn({ turn, onOpenTurn }: TurnProps) {
  return useCallback(() => onOpenTurn(turn), [onOpenTurn, turn]);
}

function Prompt({ turn, lines, onOpen }: { turn: ReadingTurn; lines: 4 | 8; onOpen: () => void }) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter") onOpen();
    },
    [onOpen],
  );
  if (!turn.prompt) return null;
  return (
    <div
      role="button"
      tabIndex={0}
      title="Open in chat"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      style={promptStyle}
    >
      <div style={promptClampStyle[lines]}>{turn.prompt.text.trim() || "(attachment)"}</div>
    </div>
  );
}

function LinkButton({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onPress} style={linkButtonStyle}>
      {children}
    </button>
  );
}

function TurnMeta({
  turn,
  onOpen,
  children,
}: {
  turn: ReadingTurn;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <div style={metaStyle}>
      {turn.hiddenStepCount > 0 ? <span>{stepsLabel(turn.hiddenStepCount)}</span> : null}
      {turn.answer.length === 0 && turn.prompt ? <span>No answer yet</span> : null}
      {children}
      <LinkButton onPress={onOpen}>Open in chat</LinkButton>
    </div>
  );
}

function Answer({
  turn,
  renderAnswer,
}: {
  turn: ReadingTurn;
  renderAnswer: ReadingOverviewProps["renderAnswer"];
}) {
  return (
    <>
      {turn.answer.map((item) => (
        <div key={item.id}>{renderAnswer(item)}</div>
      ))}
    </>
  );
}

function OlderHistory({
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
}: Pick<ReadingOverviewProps, "hasOlder" | "isLoadingOlder" | "onLoadOlder">) {
  if (!hasOlder) return null;
  return (
    <div style={olderHistoryStyle}>
      {isLoadingOlder ? (
        "Loading earlier turns…"
      ) : (
        <LinkButton onPress={onLoadOlder}>Load earlier turns</LinkButton>
      )}
    </div>
  );
}

function NewspaperTurn({
  turn,
  onOpenTurn,
  renderAnswer,
}: TurnProps & { renderAnswer: ReadingOverviewProps["renderAnswer"] }) {
  const open = useOpenTurn({ turn, onOpenTurn });
  return (
    <section style={newspaperTurnStyle}>
      <Prompt turn={turn} lines={PROMPT_LINES_NEWSPAPER} onOpen={open} />
      <Answer turn={turn} renderAnswer={renderAnswer} />
      <TurnMeta turn={turn} onOpen={open} />
    </section>
  );
}

function Newspaper(props: ReadingOverviewProps) {
  const older = useMemo(
    () => ({
      hasOlder: props.hasOlder,
      isLoadingOlder: props.isLoadingOlder,
      loadOlder: props.onLoadOlder,
    }),
    [props.hasOlder, props.isLoadingOlder, props.onLoadOlder],
  );
  const startKey = props.turns[0]?.id ?? null;
  const handleNearStart = useNearStartLoader(older, startKey);
  return (
    <ColumnScroller
      testID="reading-overview-newspaper"
      bottomInset={props.bottomInset}
      columnMinWidth={COLUMN_WIDTH}
      startKey={startKey}
      onNearStart={handleNearStart}
    >
      <LoadingOlder visible={props.isLoadingOlder} />
      {props.turns.map((turn) => (
        <NewspaperTurn
          key={turn.id}
          turn={turn}
          onOpenTurn={props.onOpenTurn}
          renderAnswer={props.renderAnswer}
        />
      ))}
    </ColumnScroller>
  );
}

function useOverflows(ref: RefObject<HTMLDivElement | null>, contentKey: unknown): boolean {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollHeight > CARD_BODY_MAX_HEIGHT + 1);
    measure();
    // The body's own box is capped, so watch what grows inside it.
    const observer = new ResizeObserver(measure);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [contentKey, ref]);
  return overflows;
}

function Card({
  turn,
  renderAnswer,
  onOpenTurn,
}: TurnProps & { renderAnswer: ReadingOverviewProps["renderAnswer"] }) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overflows = useOverflows(bodyRef, turn.answer);
  const open = useOpenTurn({ turn, onOpenTurn });
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);

  return (
    <article style={cardStyle}>
      <Prompt turn={turn} lines={PROMPT_LINES_CARD} onOpen={open} />
      {turn.answer.length > 0 ? (
        <div ref={bodyRef} style={expanded ? cardBodyExpandedStyle : cardBodyStyle}>
          <Answer turn={turn} renderAnswer={renderAnswer} />
          {overflows && !expanded ? <div style={cardFadeStyle} /> : null}
        </div>
      ) : null}
      <TurnMeta turn={turn} onOpen={open}>
        {overflows ? (
          <LinkButton onPress={toggleExpanded}>{expanded ? "Collapse" : "Expand"}</LinkButton>
        ) : null}
      </TurnMeta>
    </article>
  );
}

function Cards(props: ReadingOverviewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  useFollowEnd(scrollerRef, true, 0);
  const scrollerStyleWithInset = useScrollerStyle(cardsScrollerStyle, props.bottomInset);
  return (
    <div ref={scrollerRef} data-testid="reading-overview-cards" style={scrollerStyleWithInset}>
      <OlderHistory
        hasOlder={props.hasOlder}
        isLoadingOlder={props.isLoadingOlder}
        onLoadOlder={props.onLoadOlder}
      />
      <div style={cardsGridStyle}>
        {props.turns.map((turn) => (
          <Card
            key={turn.id}
            turn={turn}
            renderAnswer={props.renderAnswer}
            onOpenTurn={props.onOpenTurn}
          />
        ))}
      </div>
    </div>
  );
}

export function ReadingOverview(props: ReadingOverviewProps) {
  return props.mode === "newspaper" ? <Newspaper {...props} /> : <Cards {...props} />;
}
