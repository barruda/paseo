import { describe, expect, it } from "vitest";
import { detectNewlyArchived } from "./desk-archive-close";

const agents = (entries: Record<string, boolean>) =>
  new Map(
    Object.entries(entries).map(([id, archived]) => [
      id,
      { archivedAt: archived ? new Date() : null },
    ]),
  );

describe("detectNewlyArchived", () => {
  it("reports an unarchived to archived transition only", () => {
    const first = detectNewlyArchived(
      new Map(),
      new Map([["home", agents({ a: false, b: true })]]),
    );
    expect(first.newlyArchived).toEqual([]);
    const second = detectNewlyArchived(
      first.next,
      new Map([["home", agents({ a: true, b: true })]]),
    );
    expect(second.newlyArchived).toEqual(["home:a"]);
  });
  it("does nothing for servers that are not hydrated", () => {
    const result = detectNewlyArchived(new Map([["home:a", false]]), new Map());
    expect(result.newlyArchived).toEqual([]);
    expect(result.next.size).toBe(0);
  });
});
