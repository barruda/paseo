import { createMarkdownParser } from "@/utils/markdown-parser";

const markdownParser = createMarkdownParser({ linkify: false });

/**
 * Rewrites H1 and H2 headings to H3 and leaves every other line untouched.
 *
 * The parser's heading tokens carry source line ranges, so headings inside
 * fenced code, lists and blockquotes are found by the same rules that render
 * them. Setext headings (`Title` over `===` or `---`) become ATX `### Title`.
 */
export function demoteMarkdownHeadingsToH3(markdown: string): string {
  const tokens = markdownParser.parse(markdown, {});
  const lines = markdown.split("\n");
  // Walk bottom-up so earlier line indexes stay valid after each splice.
  const headings = tokens
    .filter(
      (token) =>
        token.type === "heading_open" && (token.tag === "h1" || token.tag === "h2") && token.map,
    )
    .toReversed();

  for (const token of headings) {
    const [start, end] = token.map!;
    const isSetext = end - start > 1 && /^ {0,3}(=+|-+)\s*$/.test(lines[end - 1]);
    if (isSetext) {
      const title = lines
        .slice(start, end - 1)
        .map((line) => line.trim())
        .join(" ");
      lines.splice(start, end - start, `### ${title}`);
      continue;
    }
    lines[start] = lines[start].replace(/#{1,2}(?=\s|$)/, "###");
  }

  return lines.join("\n");
}
