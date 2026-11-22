// CUSTOM(factory): parses one YAML text and validates it with a Zod schema, reporting every problem
// with the file and the line of the key it is about.
import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Document,
} from "yaml";
import type { z } from "zod";
import type { FactoryIssue } from "../../shared/factory/schema";

export type YamlSource = {
  /** 1-based line of the deepest node on `path` that exists; null for an empty document. */
  lineOf: (path: readonly PropertyKey[]) => number | null;
};

/** Parses YAML; `firstLine` is the 1-based line the text starts on (frontmatter starts on 2). */
export function parseYaml(
  text: string,
  file: string,
  firstLine = 1,
): { value: unknown; source: YamlSource; errors: FactoryIssue[] } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true });
  const lineAt = (offset: number) =>
    lineCounter.linePos(offset).line + firstLine - 1;
  const errors: FactoryIssue[] = doc.errors.map((error) => ({
    kind: "parse",
    file,
    line: error.linePos ? error.linePos[0].line + firstLine - 1 : null,
    message: error.message.split("\n")[0],
  }));
  const source: YamlSource = { lineOf: (path) => lineOf(doc, path, lineAt) };
  return { value: errors.length ? undefined : doc.toJS(), source, errors };
}

function lineOf(
  doc: Document,
  path: readonly PropertyKey[],
  lineAt: (offset: number) => number,
): number | null {
  let node: unknown = doc.contents;
  let line: number | null =
    node && (node as { range?: [number] }).range
      ? lineAt((node as { range: [number] }).range[0])
      : null;
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) =>
          isPair(item) &&
          isScalar(item.key) &&
          String(item.key.value) === String(segment),
      );
      if (!pair) break;
      if (isScalar(pair.key) && pair.key.range)
        line = lineAt(pair.key.range[0]);
      node = pair.value;
    } else if (isSeq(node) && typeof segment === "number") {
      const item = node.items[segment] as { range?: [number] } | undefined;
      if (!item) break;
      if (item.range) line = lineAt(item.range[0]);
      node = item;
    } else break;
  }
  return line;
}

/** Validates `value` with `schema`; each issue points at the line of the key it names. */
export function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
  file: string,
  source: YamlSource,
): { data: T | null; errors: FactoryIssue[] } {
  const result = schema.safeParse(value ?? {});
  if (result.success) return { data: result.data, errors: [] };
  const errors = result.error.issues.map((issue): FactoryIssue => {
    const keys =
      issue.code === "unrecognized_keys" ? (issue.keys as string[]) : [];
    const path = keys.length ? [...issue.path, keys[0]] : issue.path;
    const where = issue.path.map(String).join(".");
    return {
      kind: "schema",
      file,
      line: source.lineOf(path),
      message: where ? `${where}: ${issue.message}` : issue.message,
    };
  });
  return { data: null, errors };
}
