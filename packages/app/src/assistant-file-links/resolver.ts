import {
  classifyAssistantFileLink,
  isFileLookingAssistantToken,
  type AssistantFileLinkClassification,
  type InlinePathTarget,
} from "./parse";
import { matchSessionFilePath } from "./session-paths";
import { i18n } from "@/i18n/i18next";

export interface AssistantFileLinkSource {
  href: string;
  text?: string;
  title?: string;
  markup?: string;
  sourceInfo?: string;
  sourceType?: "inline-code";
}

export interface AssistantFileLinkContext {
  workspaceRoot?: string;
  relativePathBase?: string;
  /** CUSTOM(session-file-paths): full paths the agent's tool calls touched, newest first. */
  sessionPaths?: readonly string[];
}

export interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

export interface DirectorySuggestionResult {
  entries: DirectorySuggestionEntry[];
  error: string | null;
}

export type GetDirectorySuggestions = (input: {
  query: string;
  cwd: string;
  includeFiles: true;
  includeDirectories: false;
  matchMode: "suffix";
  limit: number;
}) => Promise<DirectorySuggestionResult>;

export type ResolvedAssistantFileLink =
  | { kind: "external"; url: string }
  | { kind: "file"; target: InlinePathTarget }
  | { kind: "ignored" };

export type AssistantFileLinkResolution =
  | { kind: "resolved"; value: ResolvedAssistantFileLink }
  | {
      kind: "needsLookup";
      ambiguousQuery: string;
      token: string;
      target: InlinePathTarget;
    };

export interface FetchDaemonResolutionInput {
  ambiguousQuery: string;
  token: string;
  target: InlinePathTarget;
  workspaceRoot?: string;
  getDirectorySuggestions: GetDirectorySuggestions;
}

export class UnresolvedFileLinkError extends Error {
  constructor(readonly token: string) {
    super(i18n.t("common.errors.noFileFound", { token }));
    this.name = "UnresolvedFileLinkError";
  }
}

export async function fetchDaemonResolution({
  ambiguousQuery,
  token,
  target,
  workspaceRoot,
  getDirectorySuggestions,
}: FetchDaemonResolutionInput): Promise<InlinePathTarget> {
  const trimmedRoot = workspaceRoot?.trim();
  if (!trimmedRoot) {
    throw new UnresolvedFileLinkError(token);
  }

  let suggestions: DirectorySuggestionResult;
  try {
    suggestions = await getDirectorySuggestions({
      query: ambiguousQuery,
      cwd: trimmedRoot,
      includeFiles: true,
      includeDirectories: false,
      matchMode: "suffix",
      limit: 1,
    });
  } catch {
    throw new UnresolvedFileLinkError(token);
  }

  const match = suggestions.entries.find((entry) => entry.kind === "file");
  if (!match || suggestions.error) {
    throw new UnresolvedFileLinkError(token);
  }

  return {
    ...target,
    path: joinWorkspacePath(trimmedRoot, match.path),
  };
}

export function classifyForResolution(
  source: AssistantFileLinkSource,
  context: AssistantFileLinkContext,
): AssistantFileLinkResolution {
  const tokenInfo = getAssistantFileLinkTokenInfo(source);
  const token = tokenInfo.token.trim();
  if (!token) {
    return { kind: "resolved", value: { kind: "ignored" } };
  }

  const classification = classifyAssistantFileLink(token, {
    workspaceRoot: context.workspaceRoot,
    decodeHref: tokenInfo.fromHref,
    explicitLink: source.sourceType !== "inline-code" && !isLinkifiedSource(source),
    relativePathBase: context.relativePathBase,
  });
  if (!classification) {
    return { kind: "resolved", value: { kind: "ignored" } };
  }
  if (classification.kind === "external") {
    return { kind: "resolved", value: { kind: "external", url: classification.raw } };
  }
  // CUSTOM(session-file-paths): a file the agent touched this session wins over the workspace guess.
  const sessionPath = matchSessionFilePath(
    stripLineSuffix(tokenInfo.fromHref ? safeDecode(token) : token, classification.target),
    context.sessionPaths,
  );
  if (sessionPath) {
    return {
      kind: "resolved",
      value: { kind: "file", target: { ...classification.target, path: sessionPath } },
    };
  }
  if (
    classification.kind === "directFile" &&
    !shouldResolveDirectFileThroughSuggestions({
      context,
      source,
      token,
      target: classification.target,
    })
  ) {
    return { kind: "resolved", value: { kind: "file", target: classification.target } };
  }

  const workspaceRoot = context.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return { kind: "resolved", value: { kind: "ignored" } };
  }

  return {
    kind: "needsLookup",
    ambiguousQuery: getAmbiguousSuggestionQuery(classification.target, workspaceRoot),
    token,
    target: classification.target,
  };
}

export function getAssistantFileLinkToken(source: AssistantFileLinkSource): string {
  return getAssistantFileLinkTokenInfo(source).token;
}

// Markdown link hrefs are percent-encoded by the renderer; inline-code and
// linkified text are raw file paths that must not be decoded.
function getAssistantFileLinkTokenInfo(source: AssistantFileLinkSource): {
  token: string;
  fromHref: boolean;
} {
  if (source.sourceType === "inline-code") {
    return { token: source.text?.trim() || source.href, fromHref: false };
  }
  if (isLinkifiedSource(source)) {
    const text = source.text?.trim();
    if (text && isFileLookingAssistantToken(text)) {
      return { token: text, fromHref: false };
    }
  }

  return { token: source.href, fromHref: true };
}

export function getAmbiguousSuggestionQuery(
  target: InlinePathTarget,
  workspaceRoot: string,
): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = target.path.replace(/\\/g, "/");
  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  const lastSlash = normalizedPath.lastIndexOf("/");
  return lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
}

export function shouldResolveDirectFileThroughSuggestions(input: {
  context: AssistantFileLinkContext;
  source: AssistantFileLinkSource;
  token: string;
  target: InlinePathTarget;
}): boolean {
  if (input.source.sourceType !== "inline-code") {
    return false;
  }

  if (isAbsoluteInlineCodeToken(input.token)) {
    return false;
  }

  const workspaceRoot = input.context.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return false;
  }

  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = input.target.path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

function isAbsoluteInlineCodeToken(token: string): boolean {
  return (
    token.startsWith("/") ||
    token.toLowerCase().startsWith("file://") ||
    /^[A-Za-z]:[\\/]/.test(token)
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// `deploy.sh:12` and `deploy.sh#L12` name deploy.sh; the parsed target already carries the lines.
function stripLineSuffix(token: string, target: InlinePathTarget): string {
  if (target.lineStart === undefined) return token;
  return token.replace(/(?::\d+(?:[-:]\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/i, "");
}

function isLinkifiedSource(source: AssistantFileLinkSource): boolean {
  return source.markup === "linkify" || source.sourceInfo === "auto";
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const child = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return root ? `${root}/${child}` : child;
}

export type { AssistantFileLinkClassification };
