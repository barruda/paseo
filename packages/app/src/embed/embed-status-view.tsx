// CUSTOM(agent-embed): centered loading / message states for the embedded page.
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function EmbedStatusView({
  message,
  loading,
  testID,
}: {
  message: string;
  loading?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.container} testID={testID}>
      {loading ? <ThemedLoadingSpinner size="small" uniProps={mutedColorMapping} /> : null}
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
