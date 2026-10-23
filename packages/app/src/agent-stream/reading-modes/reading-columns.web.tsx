// CUSTOM(reading-modes): Columns and Compact draw the chat itself as numbered pages: up to three
// columns side by side, and the next screen of columns below. They cover the chat, which stays
// mounted, and render each row with the chat's own renderer, so tool calls, thoughts and
// permissions look and work the same. Columns shows every row; Compact only prompts and final
// answers. Rows are memoized, so streaming re-renders only the tail.
import { type CSSProperties, memo, type ReactNode } from "react";
import { MessageOuterSpacingProvider } from "@/components/message";
import type { StreamLayoutItem } from "../layout";
import { PagedColumnScroller } from "./column-scroller.web";
import type { ReadingColumnsProps } from "./reading-columns";
import { WholeConversation } from "./whole-conversation.web";

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
  followRequest,
  onAtEndChange,
  bottomInset,
}: ReadingColumnsProps) {
  if (mode !== "columns" && mode !== "compact") return null;
  return (
    <WholeConversation history={history}>
      <PagedColumnScroller
        // A mode switch lays the pages out anew.
        key={mode}
        testID={`reading-${mode}`}
        bottomInset={bottomInset}
        columnMinWidth={COLUMN_MIN_WIDTH}
        maxColumns={MAX_COLUMNS}
        startKey={rows[0]?.item.id ?? null}
        followRequest={followRequest}
        onAtEndChange={onAtEndChange}
      >
        <MessageOuterSpacingProvider disableOuterSpacing>
          {rows.map((layoutItem) => (
            <ColumnRow key={layoutItem.item.id} layoutItem={layoutItem} renderRow={renderRow} />
          ))}
          {pendingPermissions}
          {turnFooter}
        </MessageOuterSpacingProvider>
      </PagedColumnScroller>
    </WholeConversation>
  );
}
