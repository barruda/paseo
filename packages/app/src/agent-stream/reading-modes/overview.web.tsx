// CUSTOM(reading-modes): Newspaper and Cards, drawn over the chat as numbered pages. The chat
// stays mounted underneath, so opening a turn scrolls the real transcript instead of rebuilding
// it. Newspaper flows prompts and final answers down the pages; Cards flows one card per turn.
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { color, PagedColumnScroller } from "./column-scroller.web";
import type { ReadingTurn } from "./model";
import type { ReadingOverviewProps } from "./overview";
import { WholeConversation } from "./whole-conversation.web";

// About 65 characters of chat text per line.
const COLUMN_WIDTH = 460;
const CARD_COLUMN_WIDTH = 380;
const CARD_BODY_MAX_HEIGHT = 340;
const PROMPT_LINES_NEWSPAPER = 8;
const PROMPT_LINES_CARD = 4;

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
const newspaperTurnStyle: CSSProperties = { marginBottom: 28 };
const cardStyle: CSSProperties = {
  breakInside: "avoid",
  marginBottom: 16,
  boxSizing: "border-box",
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

function OverviewPages({
  props,
  columnMinWidth,
  children,
}: {
  props: ReadingOverviewProps;
  columnMinWidth: number;
  children: ReactNode;
}) {
  return (
    <WholeConversation history={props.history}>
      <PagedColumnScroller
        testID={`reading-overview-${props.mode}`}
        bottomInset={props.bottomInset}
        columnMinWidth={columnMinWidth}
        startKey={props.turns[0]?.id ?? null}
        followRequest={props.followRequest}
        onAtEndChange={props.onAtEndChange}
      >
        {children}
      </PagedColumnScroller>
    </WholeConversation>
  );
}

export function ReadingOverview(props: ReadingOverviewProps) {
  if (props.mode === "newspaper") {
    return (
      <OverviewPages key="newspaper" props={props} columnMinWidth={COLUMN_WIDTH}>
        {props.turns.map((turn) => (
          <NewspaperTurn
            key={turn.id}
            turn={turn}
            onOpenTurn={props.onOpenTurn}
            renderAnswer={props.renderAnswer}
          />
        ))}
      </OverviewPages>
    );
  }
  return (
    <OverviewPages key="cards" props={props} columnMinWidth={CARD_COLUMN_WIDTH}>
      {props.turns.map((turn) => (
        <Card
          key={turn.id}
          turn={turn}
          renderAnswer={props.renderAnswer}
          onOpenTurn={props.onOpenTurn}
        />
      ))}
    </OverviewPages>
  );
}
