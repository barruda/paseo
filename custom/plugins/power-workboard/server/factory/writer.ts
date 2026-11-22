// CUSTOM(factory): the factory writer (docs/factory.md, "Active mode", ticket 10). It
// edits the YAML of a file, or the frontmatter of a Markdown file, through the `yaml` Document API,
// so comments, key order and the untouched keys stay as they are, and commits `ui: <what changed>`.
// It does not validate: the caller (FactoryShadow.edit) loads the result and undoes an invalid one.
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  isCollection,
  isMap,
  isScalar,
  parseDocument,
  type Document,
} from "yaml";
import type { FieldEdit, FileEdit } from "../../shared/factory/edits";
import { splitFrontmatter } from "../../shared/factory/frontmatter";

const run = promisify(execFile);

const YAML_OPTIONS = { lineWidth: 0 } as const;

/** The value at `path` of a plain object; undefined when a step is missing. */
function valueAt(value: unknown, path: ReadonlyArray<string | number>) {
  let node = value;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

function applyField(doc: Document, field: FieldEdit, target: unknown) {
  if (field.remove) {
    if (doc.hasIn(field.path)) doc.deleteIn(field.path);
    return;
  }
  // A parent the file lacks (an inherited block) is written whole: from `target` when it has
  // it, else as maps down to the value. setIn alone would make a sparse list of a number key.
  for (let depth = 1; depth < field.path.length; depth++) {
    const prefix = field.path.slice(0, depth);
    if (isCollection(doc.getIn(prefix, true))) continue;
    const whole =
      valueAt(target, prefix) ??
      field.path
        .slice(depth)
        .reduceRight<unknown>((inner, key) => ({ [key]: inner }), field.value);
    doc.setIn(prefix, doc.createNode(whole));
    return;
  }
  // A scalar keeps its node, so its comment and quotes stay.
  const node = doc.getIn(field.path, true);
  const value = field.value;
  if (
    isScalar(node) &&
    (value === null || ["string", "number", "boolean"].includes(typeof value))
  )
    node.value = value;
  else doc.setIn(field.path, doc.createNode(value));
}

/** Applies field edits to a YAML text; comments and untouched keys survive. */
export function editYaml(
  text: string,
  fields: readonly FieldEdit[],
  target?: unknown,
): string {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(doc.errors[0]!.message.split("\n")[0]);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  for (const field of fields) applyField(doc, field, target);
  return doc.toString(YAML_OPTIONS);
}

/** Applies field edits to a Markdown file's frontmatter and, when given, replaces its body. */
export function editFrontmatter(
  text: string,
  fields: readonly FieldEdit[],
  body?: string,
  target?: unknown,
): string {
  const split = splitFrontmatter(text) ?? {
    yaml: "",
    yamlLine: 2,
    body: text,
  };
  const yaml = fields.length
    ? editYaml(split.yaml, fields, target)
    : split.yaml
      ? `${split.yaml}\n`
      : "";
  const rest =
    body === undefined ? split.body : body.trim() ? `\n${body.trim()}\n` : "";
  return `---\n${yaml}---\n${rest}`;
}

/** Sets top-level keys (null removes one) of a YAML file or of a Markdown file's frontmatter. */
export function keyEdits(keys: Record<string, unknown>): FieldEdit[] {
  return Object.entries(keys).map(([key, value]) =>
    value === null ? { path: [key], remove: true } : { path: [key], value },
  );
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["--no-optional-locks", ...args], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** Folders the factory's .gitignore keeps out of git; removing a folder keeps what is in them. */
const UNTRACKED_FOLDERS = new Set(["memory", ".claude-plugin"]);

/** The files under a folder that belong to the config: all but `memory/` and `.claude-plugin/`. */
async function configFilesUnder(root: string, folder: string) {
  let entries;
  try {
    entries = await readdir(path.join(root, folder), {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    )
    .filter(
      (file) =>
        !file
          .slice(folder.length + 1)
          .split("/")
          .some((part) => UNTRACKED_FOLDERS.has(part)),
    );
}

export type AppliedEdits = {
  /** Paths (relative to the root) whose content changed. */
  files: string[];
  /** The ones of `files` that did not exist before. */
  created: string[];
  /** Puts every changed file back as it was. */
  undo: () => Promise<void>;
};

/** Moves a folder, across file systems too. */
async function move(from: string, to: string) {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

async function hasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries.some((entry) => !entry.isDirectory());
  } catch {
    return false;
  }
}

export type ApplyOptions = {
  /**
   * Where the git-ignored rest of a `removeFolder` folder goes (a worker's `memory/`), so the
   * loader finds no worker folder without a worker.md. Without it, that rest stays.
   */
  keepRemoved?: (folder: string) => string;
};

/** Writes the edits. A file whose text comes out the same is left alone. */
export async function applyFileEdits(
  root: string,
  edits: readonly FileEdit[],
  options: ApplyOptions = {},
): Promise<AppliedEdits> {
  const before = new Map<string, string | null>();
  const next = new Map<string, string | null>();
  const current = async (file: string) =>
    next.has(file) ? next.get(file)! : await readText(path.join(root, file));
  for (const edit of edits) {
    if (edit.removeFolder) {
      for (const file of await configFilesUnder(root, edit.file)) {
        if (!before.has(file))
          before.set(file, await readText(path.join(root, file)));
        next.set(file, null);
      }
      continue;
    }
    const old = await current(edit.file);
    if (!before.has(edit.file)) before.set(edit.file, old);
    if (edit.text !== undefined) {
      next.set(edit.file, edit.text);
      continue;
    }
    const base = old ?? edit.create;
    if (base === undefined) throw new Error(`${edit.file} does not exist`);
    next.set(
      edit.file,
      edit.file.endsWith(".md")
        ? editFrontmatter(base, edit.fields ?? [], edit.body, edit.target)
        : editYaml(base, edit.fields ?? [], edit.target),
    );
  }
  const changed = [...next].filter(([file, text]) => text !== before.get(file));
  const write = async (file: string, text: string | null) => {
    const full = path.join(root, file);
    if (text === null) await unlink(full).catch(() => undefined);
    else {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text);
    }
  };
  for (const [file, text] of changed) await write(file, text);
  // What git does not track of a removed folder: kept elsewhere when it has files, else dropped.
  const moved: Array<[string, string]> = [];
  for (const edit of edits) {
    if (!edit.removeFolder || !options.keepRemoved) continue;
    const folder = path.join(root, edit.file);
    if (await hasFiles(folder)) {
      const target = options.keepRemoved(edit.file);
      await move(folder, target);
      moved.push([folder, target]);
    } else await rm(folder, { recursive: true, force: true });
  }
  return {
    files: changed.map(([file]) => file),
    created: changed
      .filter(([file, text]) => text !== null && before.get(file) === null)
      .map(([file]) => file),
    undo: async () => {
      for (const [folder, target] of moved) await move(target, folder);
      for (const [file] of changed) await write(file, before.get(file)!);
      // Folders a new file created are left empty; drop them so the loader sees no stray worker.
      for (const [file] of changed)
        if (before.get(file) === null)
          await rmdir(path.join(root, path.dirname(file))).catch(
            () => undefined,
          );
    },
  };
}

/** True when the root is a git work tree with at least one commit. */
async function hasHead(root: string): Promise<boolean> {
  try {
    await git(root, "rev-parse", "--verify", "-q", "HEAD");
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits exactly `files` (new, changed or deleted) with `message`. Other uncommitted changes of
 * the factory stay out of the commit. Returns the commit, or null outside a git repository or
 * when the files already match `HEAD`. A failed commit unstages the files again.
 */
export async function commitFactory(
  root: string,
  candidates: readonly string[],
  message: string,
): Promise<string | null> {
  if (!candidates.length || !(await hasHead(root))) return null;
  // A deleted file git never knew has nothing to commit, and naming it would fail the pathspec.
  const tracked = new Set(
    (await git(root, "ls-files", "-z", "--", ...candidates))
      .split("\0")
      .filter(Boolean),
  );
  const files: string[] = [];
  for (const file of candidates)
    if (tracked.has(file) || (await readText(path.join(root, file))) !== null)
      files.push(file);
  if (!files.length) return null;
  await git(root, "add", "-A", "--", ...files);
  try {
    if (!(await git(root, "diff", "--cached", "--name-only", "--", ...files)))
      return null;
    await commitFiles(root, files, message);
  } catch (error) {
    await git(root, "reset", "-q", "--", ...files).catch(() => undefined);
    throw error;
  }
  return (await git(root, "rev-parse", "HEAD")).trim();
}

async function commitFiles(root: string, files: string[], message: string) {
  const identity = (await git(root, "config", "user.email").catch(() => ""))
    ? []
    : [
        "-c",
        "user.name=Power Workboard",
        "-c",
        "user.email=power-workboard@localhost",
      ];
  await git(
    root,
    ...identity,
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-q",
    "--no-verify",
    "-m",
    message,
    "--",
    ...files,
  );
}

/** Longest commit subject; a longer one is cut with "…". */
const SUBJECT_MAX = 120;

/**
 * `ui: <what changed>`: each file without its extension and the top-level keys it changed;
 * `created` names the files the edits added.
 */
export function describeEdits(
  edits: readonly FileEdit[],
  created: readonly string[] = [],
): string {
  const files = new Map<string, { verb: string | null; keys: string[] }>();
  for (const edit of edits) {
    const name = edit.file.replace(/(\/worker)?\.(md|yaml)$/, "");
    const entry = files.get(name) ?? { verb: null, keys: [] };
    files.set(name, entry);
    if (edit.removeFolder || edit.text === null) entry.verb = "remove";
    else if (created.includes(edit.file)) entry.verb = "add";
    else {
      for (const field of edit.fields ?? [])
        entry.keys.push(String(field.path[0]));
      if (edit.body !== undefined) entry.keys.push("prompt");
    }
  }
  const parts = [...files].map(([name, { verb, keys }]) =>
    verb
      ? `${verb} ${name}`
      : keys.length
        ? `${name} ${[...new Set(keys)].join(", ")}`
        : name,
  );
  const subject = `ui: ${parts.join("; ")}`;
  return subject.length > SUBJECT_MAX
    ? `${subject.slice(0, SUBJECT_MAX - 1)}…`
    : subject;
}

/**
 * The generic edit: sets top-level keys of `file` (null removes one), writes it and commits.
 * Any key works, so a new frontmatter or project field needs no writer code.
 */
export async function writeFactoryKeys(
  root: string,
  file: string,
  keys: Record<string, unknown>,
  message?: string,
): Promise<{ files: string[]; commit: string | null }> {
  const edits = [{ file, fields: keyEdits(keys) }];
  const applied = await applyFileEdits(root, edits);
  const commit = await commitFactory(
    root,
    applied.files,
    message ?? describeEdits(edits, applied.created),
  );
  return { files: applied.files, commit };
}
