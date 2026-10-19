// CUSTOM(shell-command-composer): Up/Down history and Tab completion for `!<command>` lines.
// History and path listings come from the shell-command plugin on the agent's host.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useFetchQuery } from "@/data/query";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import type { PluginClientSlashCommand } from "@/plugins/client-slash-commands";
import { BANG_COMMAND_NAME } from "@/plugins/client-slash-commands/model";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  applyShellCompletion,
  buildShellCompletions,
  findShellWord,
  shellCommandOffset,
  stepHistory,
  wantsPaths,
  type HistoryNavigation,
  type ShellCompletion,
  type ShellWord,
} from "./model";

const historyResponseSchema = z.object({ commands: z.array(z.string()) });
const pathsResponseSchema = z.object({
  entries: z.array(z.object({ value: z.string(), kind: z.enum(["file", "directory"]) })),
});
type PathEntry = z.output<typeof pathsResponseSchema>["entries"][number];
const EMPTY_HISTORY: readonly string[] = [];
const EMPTY_PATHS: readonly PathEntry[] = [];

interface ShellKeyPressEvent {
  key: string;
  hasModifier?: boolean;
  preventDefault: () => void;
  input: { text: string; selection: { start: number; end: number } };
}

/** `waiting` is Tab's first press: a single match applies without showing the list. */
type PopupState = { wordStart: number; waiting: boolean } | null;

interface ShellHost {
  serverId: string;
  pluginId: string;
  cwd: string;
  workspaceId: string | null;
  invoke: (method: string, input: unknown) => Promise<unknown>;
}

function completionId(completion: ShellCompletion): string {
  return completion.type === "history"
    ? `history:${completion.command}`
    : `path:${completion.value}`;
}

function toOption(completion: ShellCompletion): AutocompleteOption {
  if (completion.type === "history") {
    return { id: completionId(completion), label: completion.command, kind: "command" };
  }
  return { id: completionId(completion), label: completion.value, kind: completion.kind };
}

/** The agent's host, when it runs the shell-command plugin and the agent has a directory. */
function useShellHost(
  serverId: string,
  agentId: string,
  pluginCommands: readonly PluginClientSlashCommand[],
): ShellHost | null {
  const pluginId =
    pluginCommands.find((command) => command.name === BANG_COMMAND_NAME)?.pluginId ?? null;
  const cwd = useSessionStore((state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? "");
  const workspaceId = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.workspaceId ?? null,
  );
  const client = useHostRuntimeClient(serverId);
  return useMemo(() => {
    if (!pluginId || !cwd || !client) return null;
    return {
      serverId,
      pluginId,
      cwd,
      workspaceId,
      invoke: (method, rpcInput) => client.invokePluginRpc(pluginId, method, rpcInput),
    };
  }, [serverId, pluginId, cwd, workspaceId, client]);
}

/** Refetched each time a `!` line starts, so a command run a moment ago is already there. */
function useShellHistory(host: ShellHost | null, enabled: boolean): readonly string[] {
  const query = useFetchQuery({
    queryKey: ["shellCommandHistory", host?.serverId, host?.workspaceId ?? host?.cwd],
    queryFn: async () => {
      const response = await host!.invoke("history", {
        cwd: host!.cwd,
        ...(host!.workspaceId ? { workspaceId: host!.workspaceId } : {}),
      });
      return historyResponseSchema.parse(response).commands;
    },
    dataShape: "list",
    staleTimeMs: 0,
    enabled: enabled && host !== null,
    retry: false,
  });
  return query.data ?? EMPTY_HISTORY;
}

/** Folder entries for the word; `settled` once they match this word, not the previous one. */
function useShellPaths(host: ShellHost | null, word: string | null) {
  const query = useFetchQuery({
    queryKey: ["shellCommandPaths", host?.serverId, host?.cwd, word],
    queryFn: async () => {
      const response = await host!.invoke("complete-path", { cwd: host!.cwd, word: word ?? "" });
      return pathsResponseSchema.parse(response).entries;
    },
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: host !== null && word !== null,
    retry: false,
  });
  if (word === null) return { paths: EMPTY_PATHS, settled: true };
  const settled = query.isError || (query.isSuccess && !query.isPlaceholderData);
  return { paths: query.data ?? EMPTY_PATHS, settled };
}

/**
 * What the open list does next: close when the line stops being a `!` line, the cursor leaves the
 * word, or nothing matches; on Tab's first press, apply a single match or show several.
 */
function nextPopupAction(input: {
  popup: PopupState;
  word: ShellWord | null;
  settled: boolean;
  count: number;
}): "close" | "apply" | "show" | null {
  const { popup, word } = input;
  if (!popup) return null;
  if (!word || word.start !== popup.wordStart) return "close";
  if (!input.settled) return null;
  if (input.count === 0) return "close";
  if (!popup.waiting) return null;
  return input.count === 1 ? "apply" : "show";
}

export function useShellCommandCompletion(input: {
  serverId: string;
  agentId: string;
  userInput: string;
  cursorIndex: number;
  setUserInput: (text: string) => void;
  onApplied?: () => void;
  pluginCommands: readonly PluginClientSlashCommand[];
}) {
  const { userInput, setUserInput, onApplied } = input;
  const host = useShellHost(input.serverId, input.agentId, input.pluginCommands);
  const offset = shellCommandOffset(userInput);
  const isShell = offset !== null && host !== null;
  const history = useShellHistory(host, isShell);

  const [popup, setPopup] = useState<PopupState>(null);
  const cursor = Math.min(input.cursorIndex, userInput.length);
  const word = isShell ? findShellWord(userInput, cursor, offset) : null;
  const pathWord = popup && word && wantsPaths(word) ? word.text : null;
  const { paths, settled } = useShellPaths(host, pathWord);

  const completions = useMemo(
    () => (popup ? buildShellCompletions({ text: userInput, cursor, history, paths }) : []),
    [popup, userInput, cursor, history, paths],
  );
  const ordered = useMemo(() => orderAutocompleteOptions(completions), [completions]);
  const options = useMemo(() => ordered.map(toOption), [ordered]);

  const navigationRef = useRef<HistoryNavigation | null>(null);
  const apply = useCallback(
    (completion: ShellCompletion) => {
      navigationRef.current = null;
      setPopup(null);
      setUserInput(applyShellCompletion(userInput, completion));
      onApplied?.();
    },
    [userInput, setUserInput, onApplied],
  );

  const action = nextPopupAction({ popup, word, settled, count: completions.length });
  useEffect(() => {
    if (action === "close") setPopup(null);
    else if (action === "apply") apply(completions[0]!);
    else if (action === "show") setPopup((current) => current && { ...current, waiting: false });
  }, [action, apply, completions]);

  const isVisible = popup !== null && !popup.waiting && options.length > 0;
  const onSelectOption = useCallback(
    (option: AutocompleteOption) => {
      const completion = ordered.find((candidate) => completionId(candidate) === option.id);
      if (completion) apply(completion);
    },
    [ordered, apply],
  );
  const list = useAutocomplete({ isVisible, options, query: word?.text ?? "", onSelectOption });

  // Tab opens the list; Up and Down walk history. Both only on a one-line `!` text.
  const onClosedKeyPress = useCallback(
    (event: ShellKeyPressEvent): boolean => {
      const text = event.input.text;
      const textOffset = shellCommandOffset(text);
      if (event.hasModifier || textOffset === null) return false;
      if (event.key === "Tab") {
        event.preventDefault();
        const start = findShellWord(text, event.input.selection.start, textOffset).start;
        setPopup({ wordStart: start, waiting: true });
        return true;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
      const step = stepHistory({
        navigation: navigationRef.current,
        history,
        text,
        direction: event.key === "ArrowUp" ? "up" : "down",
      });
      if (!step) return false;
      event.preventDefault();
      navigationRef.current = step.navigation;
      if (step.text !== text) setUserInput(step.text);
      return true;
    },
    [history, setUserInput],
  );

  const onKeyPress = useCallback(
    (event: ShellKeyPressEvent): boolean => {
      if (!isShell) return false;
      if (!popup) return onClosedKeyPress(event);
      if (event.key === "Escape") {
        event.preventDefault();
        setPopup(null);
        return true;
      }
      if (!popup.waiting) return list.onKeyPress(event);
      // Tab again while the folder listing loads does nothing, instead of leaving the composer.
      if (event.key !== "Tab") return false;
      event.preventDefault();
      return true;
    },
    [isShell, popup, list, onClosedKeyPress],
  );

  return {
    isVisible,
    options,
    selectedIndex: list.selectedIndex,
    onSelectOption,
    onKeyPress,
  };
}
