import { usesDesktopBindings } from "./internal/conventions";
import { createKeyboardPipeline } from "./internal/pipeline";
import { overlays } from "./internal/overlays";
import { attachKeyboardSources, publishKeyboardPolicy } from "./internal/sources";
import type { KeyboardSourceInput } from "./internal/sources/contract";
import type { KeyboardInputEvent } from "./internal/overlays";
import { hasActiveOverlay } from "./internal/overlay-dispatch";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "expo-router";
import { useTaskNavigationStore } from "@/task-navigation/store"; // CUSTOM(tasks-mode)
import { isVoiceHoldKeyEvent } from "@/voice/use-voice-hold-key"; // CUSTOM(voice-hold-to-talk)
import { dispatchVoiceEscape } from "@/keyboard/voice-escape"; // CUSTOM(voice-exit)
import { subscribeEscapeSwallowed } from "@/jev-router/triple-esc"; // CUSTOM(jev-router)
import {
  isBrowserInBottomPanel,
  isCloseSessionKey,
  isNewSessionKey,
  isTabCycleKey,
} from "@/workspace-tabs/bottom-panel-browser"; // CUSTOM(bottom-panel-tab-keys)
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import {
  type ChordState,
  buildEffectiveBindings,
  getWorkspaceIndexJumpModifierKey,
} from "@/keyboard/keyboard-shortcuts";
import { shouldPublishBrowserShortcutPolicy } from "@/keyboard/internal/sources/electron-browser";
import type { KeyboardShortcutPayload } from "@/keyboard/actions";
import {
  routeKeyboardShortcut,
  type ShortcutAction,
  type ShortcutCallbackName,
} from "@/keyboard/route-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import {
  type ActiveWorkspaceSelection,
  navigateToLastWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";

export function useKeyboardShortcuts({
  enabled,
  isMobile,
  isWorkspaceFocusModeEnabled,
  toggleAgentList,
  toggleBothSidebars,
  exitFocusMode,
  cycleTheme,
  // CUSTOM(do-not-disturb): toggle notification silencing
  toggleDoNotDisturb,
}: {
  enabled: boolean;
  isMobile: boolean;
  isWorkspaceFocusModeEnabled: boolean;
  toggleAgentList: () => void;
  toggleBothSidebars?: () => void;
  exitFocusMode: () => void;
  cycleTheme?: () => void;
  // CUSTOM(do-not-disturb): toggle notification silencing
  toggleDoNotDisturb?: () => void;
}) {
  const tasksMode = useTaskNavigationStore((s) => s.enabled); // CUSTOM(tasks-mode)
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const pathname = usePathname();
  const router = useRouter();
  const resetModifiers = useKeyboardShortcutsStore((s) => s.resetModifiers);
  const { overrides } = useKeyboardShortcutOverrides();
  const bindings = useMemo(() => buildEffectiveBindings(overrides), [overrides]);
  const isMac = getShortcutOs() === "mac";
  const openProjectPickerAction = useOpenAddProject();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const keyboardWorkspaceSelectionRef = useRef<ActiveWorkspaceSelection | null>(null);
  const publishBrowserShortcutPolicy = useCallback(
    (chordState?: ChordState) => {
      publishKeyboardPolicy({
        bindings,
        chordState,
        isMac,
        usesDesktopBindings,
        tasksMode,
        enabled,
      });
    },
    [bindings, enabled, isMac, tasksMode],
  );

  useEffect(() => {
    if (activeWorkspaceSelection) {
      keyboardWorkspaceSelectionRef.current = activeWorkspaceSelection;
    }
  }, [activeWorkspaceSelection]);

  useEffect(() => {
    publishBrowserShortcutPolicy();
  }, [publishBrowserShortcutPolicy]);

  // Only the modifier that actually performs the workspace-index jump on this
  // runtime should reveal the sidebar number badges (Alt on web, Cmd on
  // desktop Mac, Ctrl on desktop non-Mac). The store ORs altDown/cmdOrCtrlDown
  // to drive badge visibility, so we set the flag matching this runtime.
  // Derived from the effective bindings: `null` when the user unassigned or
  // rebound the jump shortcut, and no `event.key` ever equals null, so the
  // badges simply never appear.
  const badgeModifierKey = getWorkspaceIndexJumpModifierKey(
    { isMac, usesDesktopBindings: usesDesktopBindings, tasksMode },
    bindings,
  );

  // The keyup listener matches the released key against the current modifier,
  // so a modifier held while the jump binding changes could never be released
  // and the badges would stay up until a blur. Clear them when it changes.
  useEffect(() => {
    resetModifiers();
  }, [badgeModifierKey, resetModifiers]);

  const setBadgeModifierDown = (down: boolean) => {
    const state = useKeyboardShortcutsStore.getState();
    if (usesDesktopBindings) {
      state.setCmdOrCtrlDown(down);
    } else {
      state.setAltDown(down);
    }
  };

  const callbacksByName: Record<ShortcutCallbackName, (() => void) | undefined> = {
    "toggle-agent-list": toggleAgentList,
    "toggle-both-sidebars": toggleBothSidebars,
    "cycle-theme": cycleTheme,
    // CUSTOM(do-not-disturb): toggle notification silencing
    "toggle-do-not-disturb": toggleDoNotDisturb,
  };

  const performShortcutAction = (
    action: ShortcutAction,
    captureFocusRestore: () => void,
  ): boolean => {
    switch (action.kind) {
      case "none":
        return false;
      case "dispatch":
        return keyboardActionDispatcher.dispatch(action.action);
      case "navigate-workspace":
        keyboardWorkspaceSelectionRef.current = {
          serverId: action.serverId,
          workspaceId: action.workspaceId,
        };
        navigateToWorkspace({ serverId: action.serverId, workspaceId: action.workspaceId });
        return true;
      case "navigate-last-workspace":
        if (navigateToLastWorkspace()) {
          return true;
        }
        router.replace(buildOpenProjectRoute());
        return true;
      case "router-replace":
        router.replace(action.route as Parameters<typeof router.replace>[0]);
        return true;
      case "router-back":
        router.back();
        return true;
      case "router-push":
        router.push(action.route as Parameters<typeof router.push>[0]);
        return true;
      case "open-project-picker":
        void openProjectPickerAction();
        return true;
      case "callback":
        callbacksByName[action.name]?.();
        return true;
      case "command-center-toggle": {
        if (action.nextOpen) {
          captureFocusRestore();
        }
        useKeyboardShortcutsStore
          .getState()
          .setCommandCenterOpen(action.nextOpen, action.tab, action.scope);
        return true;
      }
      case "shortcuts-dialog-toggle":
        useKeyboardShortcutsStore.getState().setShortcutsDialogOpen(action.nextOpen);
        return true;
    }
  };

  const routeAndPerformShortcut = (input: {
    action: string;
    payload: KeyboardShortcutPayload;
    captureFocusRestore: () => void;
  }): boolean => {
    const store = useKeyboardShortcutsStore.getState();
    const shortcutAction = routeKeyboardShortcut(
      { action: input.action, payload: input.payload },
      {
        pathname,
        isMobile,
        sidebarShortcutTargets: store.sidebarShortcutWorkspaceTargets,
        navigationActiveWorkspace:
          keyboardWorkspaceSelectionRef.current ?? activeWorkspaceSelection,
        commandCenterOpen: store.commandCenterOpen,
        shortcutsDialogOpen: store.shortcutsDialogOpen,
      },
    );
    const handled = performShortcutAction(shortcutAction, input.captureFocusRestore);
    if (handled && isWorkspaceFocusModeEnabled && input.action.startsWith("sidebar.")) {
      exitFocusMode();
    }
    return handled;
  };

  const getContext = useStableEvent(() => ({
    isMac,
    usesDesktopBindings: usesDesktopBindings,
    tasksMode: useTaskNavigationStore.getState().enabled, // CUSTOM(tasks-mode)
    commandCenterOpen: useKeyboardShortcutsStore.getState().commandCenterOpen,
  }));
  const getBindings = useStableEvent(() => bindings);
  const isCapturing = useStableEvent(() => useKeyboardShortcutsStore.getState().capturingShortcut);
  const dispatchMatch = useStableEvent(
    (match: import("./keyboard-shortcuts").KeyboardShortcutMatch, input: KeyboardSourceInput) =>
      routeAndPerformShortcut({
        action: match.action,
        payload: match.payload,
        captureFocusRestore: input.captureFocusRestore,
      }),
  );
  const chordChanged = useStableEvent(
    (previous: ChordState, next: ChordState, input: KeyboardSourceInput | null) => {
      const isBrowserInput = input !== null && "browserId" in input.event;
      if (
        !input ||
        shouldPublishBrowserShortcutPolicy({
          isBrowserInput,
          previousChordState: previous,
          nextChordState: next,
        })
      ) {
        publishBrowserShortcutPolicy(next);
      }
    },
  );
  const beforeResolve = useStableEvent((input: KeyboardSourceInput) => {
    const event = input.event;
    const key = event.key ?? "";
    // CUSTOM(voice-exit): the Esc that leaves voice mode never counts toward the interrupt chord.
    if (
      !useKeyboardShortcutsStore.getState().commandCenterOpen &&
      dispatchVoiceEscape(event, (action) => keyboardActionDispatcher.dispatch(action))
    ) {
      pipelineRef.current?.dispose();
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    // CUSTOM(bottom-panel-tab-keys): the page in the bottom panel (Warp) already used it.
    if (
      "browserId" in event &&
      typeof event.browserId === "string" &&
      (isTabCycleKey(event) || isCloseSessionKey(event) || isNewSessionKey(event)) &&
      isBrowserInBottomPanel(event.browserId)
    ) {
      return false;
    }
    if (key === "Escape" && pathname.startsWith("/settings") && !isMobile && hasActiveOverlay()) {
      return false;
    }
    if (key === badgeModifierKey && !event.shiftKey) {
      setBadgeModifierDown(true);
    }
    if (key === "Shift") {
      const state = useKeyboardShortcutsStore.getState();
      if (state.altDown || state.cmdOrCtrlDown) {
        state.resetModifiers();
      }
    }

    return true;
  });

  const pipeline = useMemo(
    () =>
      createKeyboardPipeline({
        getContext,
        getBindings,
        isCapturing,
        dispatch: dispatchMatch,
        overlays,
        beforeResolve,
        chordChanged,
      }),
    [getContext, getBindings, isCapturing, dispatchMatch, beforeResolve, chordChanged],
  );

  const pipelineRef = useRef<typeof pipeline | null>(null);
  pipelineRef.current = pipeline;

  // CUSTOM(chat-esc-focus): a click between two presses ends a pending chord, so Esc, click, Esc
  // is two single presses (focus the composer twice), not `Escape Escape` (interrupt the agent).
  const dropPendingChord = useStableEvent(() => {
    if (pipeline.hasPendingChord()) pipeline.dispose();
  });

  const ignoreDomEvent = useStableEvent((event: KeyboardEvent) => isVoiceHoldKeyEvent(event));

  const handleKeyUp = useStableEvent((event: KeyboardInputEvent) => {
    const key = event.key ?? "";
    if (key === badgeModifierKey) {
      setBadgeModifierDown(false);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const detach = attachKeyboardSources({
      keyDown: pipeline.keyDown,
      keyUp: handleKeyUp,
      blur: resetModifiers,
      commandCenterOpen: () => useKeyboardShortcutsStore.getState().commandCenterOpen,
      ignoreDomEvent,
      subscribeCommandCenter: (listener) =>
        useKeyboardShortcutsStore.subscribe((state, previous) => {
          if (state.commandCenterOpen !== previous.commandCenterOpen) listener();
        }),
    });
    // CUSTOM(jev-router): Esc 3×. Escapes swallowed after the restart never reach the pipeline
    // (triple-esc.ts stops them first), so a chord left half-typed is dropped here.
    const unsubscribeEscapeSwallowed = subscribeEscapeSwallowed(dropPendingChord);
    const canListen =
      typeof window !== "undefined" && typeof window.addEventListener === "function";
    if (canListen) window.addEventListener("pointerdown", dropPendingChord, true);
    return () => {
      unsubscribeEscapeSwallowed();
      if (canListen) window.removeEventListener("pointerdown", dropPendingChord, true);
      detach();
      pipeline.dispose();
    };
  }, [enabled, pipeline, handleKeyUp, ignoreDomEvent, dropPendingChord, resetModifiers]);
}
