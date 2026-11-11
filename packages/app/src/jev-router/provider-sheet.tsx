import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DEFAULT_JEV_MODEL, DEFAULT_TYPESAFE_API_URL } from "@getpaseo/protocol/jev-router";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { InstalledPlugin } from "@/plugins/types";
import type { JevProviderField, JevRouterFormModel } from "./form-model";
import { useJevRouterFormModel, useJevRouterSave } from "./sheet";

// CUSTOM(jev-router): the host's TypeSafe provider (key, endpoint, Jev model), opened from
// Settings > Bruno's Customizations > Composer. Each daemon keeps its own, so paseo-telus can call
// Jev on another TypeSafe account or gateway than the personal host. Same settings document and
// form model as the router sheet; empty fields fall back to route.py's environment.

export function JevProviderSheet({
  plugin,
  onClose,
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
}) {
  const form = useJevRouterFormModel(plugin);
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const header = useMemo<SheetHeader>(() => ({ title: "TypeSafe provider" }), []);
  const handleSavePress = useJevRouterSave(form, plugin, onClose);

  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID="jev-provider-settings">
      {state.load.status === "loading" ? (
        <View style={styles.loading}>
          <LoadingSpinner size="large" color={styles.spinnerColor.color} />
        </View>
      ) : null}
      {state.load.status === "error" ? (
        <Text style={styles.errorText}>{state.load.message}</Text>
      ) : null}
      {state.load.status === "ready" ? (
        <View style={styles.body}>
          <Text style={styles.hint}>
            The TypeSafe account Jev is called with on this host. An empty field uses the
            daemon&apos;s environment (TYPESAFE_API_KEY, ~/.config/typesafe/env) or route.py&apos;s
            default.
          </Text>
          <ProviderField
            form={form}
            field="apiKey"
            title="API key"
            hint="Stored as plain JSON in this host's plugin settings."
            placeholder="From the environment"
            secure
          />
          <ProviderField
            form={form}
            field="apiUrl"
            title="Endpoint"
            hint="System One URL of the account or gateway."
            placeholder={DEFAULT_TYPESAFE_API_URL}
            error={state.apiUrlError}
          />
          <ProviderField
            form={form}
            field="jevModel"
            title="Jev model"
            hint="The router's thresholds were measured on the default."
            placeholder={DEFAULT_JEV_MODEL}
          />
          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
          <View style={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              onPress={onClose}
              disabled={state.saving}
              testID="jev-provider-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              style={styles.actionButton}
              onPress={handleSavePress}
              disabled={!state.canSave}
              testID="jev-provider-save"
            >
              {state.saving ? "Saving…" : "Save"}
            </Button>
          </View>
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function ProviderField({
  form,
  field,
  title,
  hint,
  placeholder,
  secure = false,
  error = null,
}: {
  form: JevRouterFormModel;
  field: JevProviderField;
  title: string;
  hint: string;
  placeholder: string;
  secure?: boolean;
  error?: string | null;
}) {
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const handleChange = useCallback(
    (text: string) => form.setProviderField(field, text),
    [field, form],
  );
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <FormTextInput
        key={state.textsVersion}
        size="sm"
        initialValue={state.draft[field]}
        onChangeText={handleChange}
        placeholder={placeholder}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!state.saving}
        accessibilityLabel={title}
        testID={`jev-provider-${field}`}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  field: {
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
