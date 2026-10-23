// CUSTOM(reading-modes): Columns draws the chat itself, every row the chat renders, through the
// shared column scroller: up to three columns side by side, and the next screen of columns below.
// It covers the chat, which stays mounted, and renders each row with the chat's own renderer, so
// tool calls, thoughts and permissions look and work the same.
import { type CSSProperties, memo, type ReactNode, useCallback } from "react";
import { MessageOuterSpacingProvider } from "@/components/message";
import type { StreamLayoutItem } from "../layout";
import { ColumnScroller, color } from "./column-scroller.web";
import type { ReadingColumnsProps } from "./reading-columns";

const COLUMN_MIN_WIDTH = 420;
const MAX_COLUMNS = 3;

const rowStyle: CSSProperties = { breakInside: "avoid" };
const olderHistoryStyle: CSSProperties = {
  fontSize: 12,
  color: color.extraMuted,
  marginBottom: 16,
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

// A row renders again only when its layout item or the renderer changes, like the chat's rows.
const ColumnRow = memo(function ColumnRow({
  layoutItem,
  renderRow,
}: {
  layoutItem: StreamLayoutItem;
  renderRow: (layoutItem: StreamLayoutItem) => ReactNode;
}) {
  return <div style={rowStyle}>{renderRow(layoutItem)}</div>;
});

function OlderHistory({ history }: { history: ReadingColumnsProps["history"] }) {
  const handlePress = useCallback(() => {
    void history.loadOlder();
  }, [history]);
  if (!history.hasOlder) return null;
  return (
    <div style={olderHistoryStyle}>
      {history.isLoadingOlder ? (
        "Loading earlier messages…"
      ) : (
        <button type="button" onClick={handlePress} style={linkButtonStyle}>
          Load earlier messages
        </button>
      )}
    </div>
  );
}

export function ReadingColumns({
  mode,
  rows,
  renderRow,
  pendingPermissions,
  turnFooter,
  history,
  bottomInset,
}: ReadingColumnsProps) {
  if (mode !== "columns") return null;
  return (
    <ColumnScroller
      testID="reading-columns"
      bottomInset={bottomInset}
      columnMinWidth={COLUMN_MIN_WIDTH}
      maxColumns={MAX_COLUMNS}
    >
      <MessageOuterSpacingProvider disableOuterSpacing>
        <OlderHistory history={history} />
        {rows.map((layoutItem) => (
          <ColumnRow key={layoutItem.item.id} layoutItem={layoutItem} renderRow={renderRow} />
        ))}
        {pendingPermissions}
        {turnFooter}
      </MessageOuterSpacingProvider>
    </ColumnScroller>
  );
}
