import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Pressable,
  View,
  type NativeSyntheticEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type TargetedEvent,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);

const chevronColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface TriggerState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
}

type TriggerStyleProp = StyleProp<ViewStyle> | ((state: TriggerState) => StyleProp<ViewStyle>);

interface ComboboxTriggerProps extends Omit<PressableProps, "style" | "children"> {
  style?: TriggerStyleProp;
  children?: ReactNode;
  chevron?: ReactNode | null;
  // Fill the Pressable's width and use the standard sidebar-row gap, so the
  // trigger reads as a full-width row: the label expands and the chevron pins to
  // the trailing edge. Default (false) keeps the content-width pill used by the
  // composer triggers.
  block?: boolean;
  // CUSTOM(chip-cycle): when set, the chevron is its own button and a press on the rest of the
  // trigger goes to `onPress`.
  onChevronPress?: () => void;
}

export const ComboboxTrigger = forwardRef<View, ComboboxTriggerProps>(function ComboboxTrigger(
  { children, chevron, style, block = false, onFocus, onBlur, onChevronPress, ...props },
  ref,
): ReactElement {
  const [focused, setFocused] = useState(false);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (typeof style === "function") {
        return style({ pressed, hovered, focused });
      }
      return style;
    },
    [focused, style],
  );
  const handleFocus = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );
  const handleBlur = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const isSplit = chevron !== null && onChevronPress !== undefined;
  const rowStyle = useMemo(
    () => [styles.row, block && styles.rowBlock, isSplit && styles.rowSplit],
    [block, isSplit],
  );

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      style={pressableStyle}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...props}
    >
      <View style={rowStyle}>
        {children}
        {isSplit ? (
          <Pressable
            focusable={false}
            onPress={onChevronPress}
            style={styles.chevronButton}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            testID={props.testID ? `${props.testID}-chevron` : undefined}
          >
            <View style={styles.chevronContainer}>
              {chevron ?? <ThemedChevronDown size={ICON_SIZE.sm} uniProps={chevronColorMapping} />}
            </View>
          </Pressable>
        ) : null}
        {chevron !== null &&
          !isSplit &&
          (chevron ?? (
            <View style={styles.chevronContainer}>
              <ThemedChevronDown size={ICON_SIZE.sm} uniProps={chevronColorMapping} />
            </View>
          ))}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rowBlock: {
    flexGrow: 1,
    gap: theme.spacing[2],
  },
  chevronContainer: {
    flexShrink: 0,
    transform: [{ translateY: 1 }],
  },
  // CUSTOM(chip-cycle): the chevron owns a full-height band, from 2px before the glyph to the
  // chip's trailing edge. The negative margins assume the split chips' 28px height and
  // spacing[2] horizontal padding (toolbar controls and the model chip).
  rowSplit: {
    alignSelf: "stretch",
  },
  chevronButton: {
    flexShrink: 0,
    alignSelf: "stretch",
    justifyContent: "center",
    marginLeft: -2,
    paddingLeft: 2,
    marginRight: -theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
}));
