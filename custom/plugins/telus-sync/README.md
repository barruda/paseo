# telus-sync

A Settings screen in Paseo Personal that copies UX and plugin configuration into the Paseo Telus
install on the same machine. Nothing runs on its own: the sync only happens when the button is
pressed, after a preview, and only for the checked categories.

Settings > Plugins > telus-sync > **Sincronizar com Paseo Telus**.

## What can travel

| Category                      | Files and keys                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX preferences on the daemon  | `config.json`: `features.dictation`, `features.voiceMode`, `features.webUi`                                                                                                                                                                    |
| App preferences (desktop)     | `desktop-settings.json`: `notifications.playSound`, `tabs.flexibleMovement`                                                                                                                                                                    |
| Installed and enabled plugins | `config.json`: `pluginsEnabled`, `plugins` (paths under the source home rewritten); `plugins/` managed sources (without `.git`, `.npmrc` or dotenv files); `plugins/sources.json` with URL credentials stripped; `custom-plugins-applied.json` |
| Plugin settings               | `plugin-settings/<id>/*.json`, with credential keys removed                                                                                                                                                                                    |

Plugin settings that hold execution data or agent model picks are excluded by id:
`power-workboard`, `delegation`, `jev-router` (`shared/model.ts`, `EXCLUDED_PLUGIN_SETTINGS`).
Files whose name is a credential (`tokens.json`, `credentials.json`, `*.pem`, `*.key`) and files
that are not JSON are skipped. Credential keys are dropped from JSON settings, including an
`apiKey` inside `features.dictation`/`voiceMode`. The rules are an explicit key list plus a
conservative suffix, so `openaiApiKey`, `oauthToken` and `clientSecret` are credentials while
`maxTokens`, `tokenCount` and `tokenizerPath` are ordinary settings.

A credential that only the Telus install already has is never deleted: the sync keeps its value,
and when the whole branch exists only on the Telus side it keeps the branch too, so the settings
the credential needs stay together. The preview lists each credential it kept. A credential coming
from Personal is never written. Git remotes in `sources.json` lose any `user:token@`.

## What never travels

Credentials (`local-credential`, `daemon-keypair.json`, `push-tokens.json`, `server-id`,
`cli-client-id`), agent and provider definitions, agent profiles, and everything under `agents/`,
`projects/`, `schedules/`, `runtime/`, `plugin-data/`. From `config.json` only the keys in
`CONFIG_UX_ALLOWLIST` and the plugin list travel.

Theme, fonts, sidebar layout and keyboard shortcuts live in the Electron client's localStorage
(`~/.config/Paseo*/Local Storage`), not in the daemon. Writing another Electron profile's
LevelDB while that app runs is not safe, so this screen leaves them out and says so; set them by
hand on the Telus side.

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
