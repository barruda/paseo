#!/usr/bin/env bash
# Close each running Paseo window and reopen it from its launcher, so it runs the newest install and
# keeps its dock slot. Only clients set to keep their daemon running after quit are touched:
# quitting the others would stop their daemon and its agents.
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
  if [[ "$keep" != true ]]; then
    echo "Skipped $launcher: quitting it would stop its daemon (keepRunningAfterQuit is off). Reopen it by hand."
    continue
  fi

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
  echo "Reopened $launcher"
done
