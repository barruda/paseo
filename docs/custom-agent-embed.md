# Agent embed mode (custom)

`http://127.0.0.1:6767/h/<serverId>/agent/<agentId>?embed=1` shows one agent's conversation
(timeline, composer, Stop, permission requests, attachments) with no app navigation, for an iframe
on another local page. The Assets Board's Power-workspace agent panel is the consumer. The
per-commit details (files, re-apply, verify) are in `custom/CHANGES.md`, entry `agent-embed`.

## Turning it on

The daemon serves the web app only with the web UI on. In `$PASEO_HOME/config.json`:

```json
"features": {
  "webUi": { "enabled": true, "embedAllowedOrigins": ["http://127.0.0.1:5178"] }
}
```

Both are read at startup, so restart the daemon after changing them. Entries must be exact
origins (`http(s)://host[:port]`, no path, no `*`); invalid ones are dropped with a warning in
`daemon.log`. The embedding page must use the same spelling: `localhost:5178` is a different
origin from `127.0.0.1:5178` and is refused.

## Security

| Threat                                     | Barrier                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another site frames the app (clickjacking) | Every web UI response sends `Content-Security-Policy: frame-ancestors 'self' <embedAllowedOrigins>`, plus `X-Frame-Options: SAMEORIGIN` when the list is empty.                                                                                     |
| Another site opens the WebSocket           | The existing upgrade check: Origin must be the daemon's own or in `daemon.cors.allowedOrigins`.                                                                                                                                                     |
| Another site reads an embed credential     | `POST /api/embed/credential` answers only loopback sockets whose `Origin` is the daemon's own, with `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Dest: empty` and `X-Paseo-Embed: 1`. A CORS-allowed origin such as `https://app.paseo.sh` is refused. |
| DNS rebinding                              | The existing Host allowlist.                                                                                                                                                                                                                        |

The endpoint returns a random ticket valid for 60 s and one use, kept in daemon memory. The
embedded app fetches a new one on every connect and reconnect and sends it in the hello as
`auth: { kind: "localCredential", token }`, which the protocol already accepts as any string, so
there is no protocol change. The daemon admits it like the local credential.

What it does not protect:

- **Without a daemon password the ticket adds nothing.** Every WebSocket that passes the Origin
  check is admitted as owner, as before. The barriers are the Origin check and `frame-ancestors`.
- An allowed embedding origin is trusted: code on it can clickjack the embedded conversation.
- Local processes of the same user (they can read `$PASEO_HOME/local-credential`), browser
  extensions, and XSS inside the Paseo app.
- With a password, HTTP requests the app makes with the bearer header are not covered by the
  ticket. The conversation did not need any in testing.

## Behavior inside the embed

- `navigateToAgent` opens `paseo://h/<serverId>/agent/<agentId>`, which the desktop app handles.
  `navigateToWorkspace` and opening files show an "open in the Paseo app" toast instead.
- Enter sends, although a 360–600 px page is a compact layout where Enter would insert a newline.
- The embed screen registers the agent with the session's viewed-timeline sync itself. Without
  that, the panel waits forever on its loading spinner, because only the workspace screen and the
  sheet pane trigger the first timeline fetch.
- An unknown serverId waits for the initial connection hint instead of redirecting to the welcome
  screen. The page's localStorage (`@paseo:daemon-registry`) belongs to the daemon's origin and is
  shared with any other tab of the daemon web UI.
