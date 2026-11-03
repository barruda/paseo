import type { PluginServerContext, PluginSettingsState } from '@getpaseo/plugin/server';
import { preferences, DEFAULT_PREFERENCES } from '../shared/preferences.ts';

let current = DEFAULT_PREFERENCES;
let revision = 0;
export const getPreferences = () => current;
export const preferencesRevision = () => revision;

export function initializePreferences(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  let stopped = false;
  let notifications = 0;
  const apply = (state: PluginSettingsState<typeof preferences.schema>) => {
    if (stopped) return;
    if (state.status !== 'ready') {
      console.error('token-ledger: retaining last valid preferences', state.error);
      return;
    }
    const next = preferences.schema.parse(state.values);
    if (JSON.stringify(next) !== JSON.stringify(current)) { current = next; revision++; }
  };
  const unsubscribe = settings.subscribe((state) => { notifications++; apply(state); });
  const beforeRead = notifications;
  const ready = settings.read().then((state) => {
    if (notifications === beforeRead) apply(state);
  }).catch((error) => console.error('token-ledger: could not read preferences; retaining defaults', error));
  return { ready, async dispose() { stopped = true; await unsubscribe(); await ready; } };
}
