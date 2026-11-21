import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
  type ReactElement,
} from "react";

interface ComposerKeyboardScopeValue {
  /**
   * The pane this composer sits in is the user's pane. Mouse-driven focus
   * restoration follows it; touch navigation does not restore editor focus.
   */
  isPaneFocused: boolean;
  /**
   * The composer takes input right now: keyboard actions, shortcuts, autocomplete,
   * and the fullscreen exit action. False while a compact overlay panel covers the
   * pane, which does not take pane focus.
   */
  isActiveComposer: boolean;
  /**
   * CUSTOM(model-picker-focus): identifies this composer to `@/composer/focused-composer`, so
   * shortcuts that act on its agent (Ctrl+M, ←/→) run only when its input holds the caret.
   */
  composerId: string;
}

const ComposerKeyboardScopeContext = createContext<ComposerKeyboardScopeValue>({
  isPaneFocused: false,
  isActiveComposer: false,
  composerId: "",
});

export function ComposerKeyboardScopeProvider({
  isPaneFocused,
  isActiveComposer,
  composerId,
  children,
}: PropsWithChildren<ComposerKeyboardScopeValue>): ReactElement {
  const value = useMemo(
    () => ({ isPaneFocused, isActiveComposer, composerId }),
    [isPaneFocused, isActiveComposer, composerId],
  );
  return (
    <ComposerKeyboardScopeContext.Provider value={value}>
      {children}
    </ComposerKeyboardScopeContext.Provider>
  );
}

export function useComposerKeyboardScope(): ComposerKeyboardScopeValue {
  return useContext(ComposerKeyboardScopeContext);
}
