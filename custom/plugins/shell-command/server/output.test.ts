import { describe, expect, it } from "vitest";
import { cleanOutput, keepTail } from "./output";

describe("cleanOutput", () => {
  it("strips color and cursor escapes", () => {
    expect(cleanOutput("\x1b[32mok\x1b[0m \x1b]0;title\x07done\x1b[2K")).toBe("ok done");
  });

  it("drops terminal control characters and pseudo-terminal line endings", () => {
    expect(cleanOutput("ding\x07\r\r\nnext\b\r\n")).toBe("ding\nnext\n");
  });

  it("keeps only what a carriage return leaves on the line", () => {
    expect(cleanOutput("10%\r50%\r100%\nnext\r\nlast")).toBe("100%\nnext\nlast");
  });
});

describe("keepTail", () => {
  it("returns short output unchanged", () => {
    expect(keepTail("a\nb", 10)).toEqual({ text: "a\nb", truncated: false });
  });

  it("keeps the tail from a line boundary within the byte budget", () => {
    const result = keepTail("first line\nsecond line\nthird", 16);
    expect(result).toEqual({ text: "third", truncated: true });
  });

  it("counts multi-byte characters as bytes", () => {
    const result = keepTail("ééééé", 6);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(6);
  });
});
