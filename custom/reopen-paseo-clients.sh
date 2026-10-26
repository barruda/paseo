#!/usr/bin/env bash
# Close each running Paseo window and reopen it from its launcher, so it runs the newest install and
# keeps its dock slot. A client set to keep its daemon running after quit leaves the daemon and its
# agents alone. The others (paseo-telus) stop their daemon on quit, so their daemon restarts with
# the window and its running agents stop; the user asked for those to be reopened too.
set -euo pipefail

declare -A LAUNCHERS=([Paseo]=paseo-personal [Paseo-telus]=paseo-telus)

for dir in "${!LAUNCHERS[@]}"; do
  config="$HOME/.config/$dir"
  launcher="${LAUNCHERS[$dir]}"
  # Electron's single-instance lock points at "<hostname>-<pid>" of the running client.
  target="$(readlink "$config/SingletonLock" 2>/dev/null)" || continue
  pid="${target##*-}"
  [[ "$(ps -o args= -p "$pid" 2>/dev/null)" == *Paseo.bin* ]] || continue

  keep="$(node -e 'try { const s = require(process.argv[1]); console.log(s.settings?.daemon?.keepRunningAfterQuit === true) } catch { console.log(false) }' "$config/desktop-settings.json")"
  daemon_note=""
  [[ "$keep" == true ]] || daemon_note=" (its daemon restarted with it: keepRunningAfterQuit is off)"

  kill -TERM "$pid"
  for _ in $(seq 75); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "Skipped $launcher: it did not quit within 15 s." >&2
    continue
  fi
  setsid gtk-launch "$launcher" >/dev/null 2>&1 < /dev/null &
  echo "Reopened $launcher$daemon_note"
done
