const SEPARATOR = ' · ';
const NBSP = ' ';

/**
 * Joins usage figures so a narrow line wraps between them, never inside one:
 * each segment keeps its words together ("cache 517.1k", "79 tok/s") and the
 * separator stays at the end of the line it closes. A "model / effort" segment
 * may still break after its slash, so a long model name fits a narrow footer.
 * Segments may themselves hold separators (the tokens line does).
 */
export function joinWrappableSegments(segments: readonly string[]): string {
  return segments
    .flatMap((segment) => segment.split(SEPARATOR))
    .map((segment) =>
      segment
        .split(' / ')
        .map((part) => part.replace(/ /g, NBSP))
        .join(`${NBSP}/ `),
    )
    .join(`${NBSP}· `);
}
