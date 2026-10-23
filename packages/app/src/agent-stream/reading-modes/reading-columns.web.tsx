// CUSTOM(reading-modes): Columns draws the chat itself, every row the chat renders, through the
// shared column scroller: up to three columns side by side, and the next screen of columns below.
// It covers the chat, which stays mounted, and renders each row with the chat's own renderer, so
// tool calls, thoughts and permissions look and work the same.
import { type CSSProperties, memo, type ReactNode } from "react";
import { MessageOuterSpacingProvider } from "@/components/message";
import type { StreamLayoutItem } from "../layout";
import { ColumnScroller, LoadingOlder, useNearStartLoader } from "./column-scroller.web";
import type { ReadingColumnsProps } from "./reading-columns";

const COLUMN_MIN_WIDTH = 420;
const MAX_COLUMNS = 3;

const rowStyle: CSSProperties = { breakInside: "avoid" };
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
    <ActiveReadingColumns
      rows={rows}
      renderRow={renderRow}
      pendingPermissions={pendingPermissions}
      turnFooter={turnFooter}
      history={history}
      bottomInset={bottomInset}
    />
  );
}

function ActiveReadingColumns({
  rows,
  renderRow,
  pendingPermissions,
  turnFooter,
  history,
  bottomInset,
}: Omit<ReadingColumnsProps, "mode">) {
  const startKey = rows[0]?.item.id ?? null;
  const handleNearStart = useNearStartLoader(history, startKey);
  return (
    <ColumnScroller
      testID="reading-columns"
      bottomInset={bottomInset}
      columnMinWidth={COLUMN_MIN_WIDTH}
      maxColumns={MAX_COLUMNS}
      startKey={startKey}
      onNearStart={handleNearStart}
    >
      <MessageOuterSpacingProvider disableOuterSpacing>
        <LoadingOlder visible={history.isLoadingOlder} />
        {rows.map((layoutItem) => (
          <ColumnRow key={layoutItem.item.id} layoutItem={layoutItem} renderRow={renderRow} />
        ))}
        {pendingPermissions}
        {turnFooter}
      </MessageOuterSpacingProvider>
    </ColumnScroller>
  );
}
