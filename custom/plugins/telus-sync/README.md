# telus-sync

A Settings screen in Paseo Personal that copies UX and plugin configuration into the Paseo Telus
install on the same machine. Nothing runs on its own: the sync only happens when the button is
pressed, after a preview, and only for the checked categories.

Settings > Plugins > telus-sync > **Sincronizar com Paseo Telus**.

## What can travel

| Category                      | Files and keys                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX preferences on the daemon  | `config.json`: `features.dictation`, `features.voiceMode`, `features.webUi`                                                                                                                                                                    |
| App preferences (desktop)     | `desktop-settings.json`: `notifications.playSound`, `tabs.flexibleMovement`. Needs Paseo Telus closed; the app caches the file.                                                                                                                |
| Installed and enabled plugins | `config.json`: `pluginsEnabled`, `plugins` (paths under the source home rewritten); `plugins/` managed sources (without `.git`, `.npmrc` or dotenv files); `plugins/sources.json` with URL credentials stripped; `custom-plugins-applied.json` |
| Plugin settings               | `plugin-settings/<id>/*.json`, with credential keys removed                                                                                                                                                                                    |

Plugin settings that hold execution data or agent model picks are excluded by id:
`power-workboard`, `delegation`, `jev-router` (`shared/model.ts`, `EXCLUDED_PLUGIN_SETTINGS`).
Files whose name looks like a credential and files that are not JSON are skipped, and every
credential-looking key is dropped from JSON settings, including an `apiKey` inside
`features.dictation`/`voiceMode`. Git remotes in `sources.json` lose any `user:token@`.

## What never travels

Credentials (`local-credential`, `daemon-keypair.json`, `push-tokens.json`, `server-id`,
`cli-client-id`), agent and provider definitions, agent profiles, and everything under `agents/`,
`projects/`, `schedules/`, `runtime/`, `plugin-data/`. From `config.json` only the keys in
`CONFIG_UX_ALLOWLIST` and the plugin list travel.

## Decision: theme and visuals are not synced

Theme, fonts, sidebar layout and keyboard shortcuts live in the Electron client's localStorage
(`~/.config/Paseo*/Local Storage`), not in the daemon. The sync does not read or write them, and
the screen says so above the checklist.

This is deliberate. Chromium keeps that profile locked and caches it in memory, so writing
another profile's LevelDB while Paseo Telus runs can be lost or corrupt the store. There is no
supported export/import for the app settings blob, and hand-editing LevelDB is fragile enough
that a visual preference does not justify it. Set those preferences by hand in Paseo Telus.

`desktop-settings.json` is different: it is a plain JSON file owned by the Electron main process.
The sync writes it only while Paseo Telus is closed. If the app is open, the desktop category is
reported unavailable with the reason, because the running app caches the whole document and
writes it back on its next save, undoing the sync. Reopen the app after a sync to load the new
values.

## Backup and rollback

Before writing, every Telus file that will be overwritten is copied to
`~/.paseo-backups/telus-sync/<timestamp>/files/{telus-home,telus-electron}/`, with a
`manifest.json` listing the source, the target, the categories and what was created. Files the
sync creates are recorded so a rollback removes them. The five newest backups are kept.

Rollback restores the files captured by a backup, after a confirmation. Neither a sync nor a
rollback restarts a daemon or touches a running agent; the screen only says what to reopen or
reload.

## Environment overrides

`PASEO_TELUS_HOME`, `PASEO_APP_DIR`, `PASEO_TELUS_APP_DIR` and
`PASEO_TELUS_SYNC_BACKUP_ROOT` override the defaults. The sync is disabled when the daemon's
`PASEO_HOME` basename is not `.paseo`.
