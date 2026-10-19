#!/usr/bin/env bash
# Stop both Paseo daemons (~/.paseo and ~/.paseo-telus), close both Paseo windows if they are
# open, and reopen both from their launchers. Every step waits at most 5 s before killing.
# This stops every running agent on both daemons.
#
# It detaches first: run from a Paseo terminal or a `!` command, it is a child of the daemon it
# is about to stop. Follow along in the log it prints.
set -euo pipefail

TIMEOUT=5
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/kill-paseos-and-daemons.log"

if [[ -z "${KILL_PASEOS_DETACHED:-}" ]]; then
  mkdir -p "$(dirname "$LOG")"
  KILL_PASEOS_DETACHED=1 setsid -f "$0" "$@" >"$LOG" 2>&1 </dev/null
  echo "Restarting the Paseo daemons and windows in the background. Log: $LOG"
  exit 0
fi

# launcher | daemon home | Electron user data dir
TARGETS=(
  "paseo-personal|$HOME/.paseo|$HOME/.config/Paseo"
  "paseo-telus|$HOME/.paseo-telus|$HOME/.config/Paseo-telus"
)

# The paseo CLI of the build the launchers point at.
exec_line="$(grep -m1 '^Exec=' "$HOME/.local/share/applications/paseo-personal.desktop")"
app="$(sed -E 's/.*"([^"]+\/Paseo)".*/\1/' <<<"$exec_line")"
PASEO_CLI="$(dirname "$app")/resources/bin/paseo"
[[ -x "$PASEO_CLI" ]] || { echo "paseo CLI not found at $PASEO_CLI" >&2; exit 1; }

log() { echo "[$(date +%T)] $*"; }

# SIGTERM, then SIGKILL after $TIMEOUT seconds.
stop_pid() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || return 0
  for _ in $(seq $((TIMEOUT * 5))); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  log "  pid $pid did not exit in ${TIMEOUT}s, killing it"
  kill -KILL "$pid" 2>/dev/null || true
}

stop_daemon() {
  local home="$1"
  [[ -d "$home" ]] || return 0
  env -u PASEO_AGENT_ID -u PASEO_HOME "$PASEO_CLI" daemon stop --home "$home" \
    --timeout "$TIMEOUT" --force --kill-timeout 2 2>&1 | sed 's/^/  /' || true
  # Leftovers of this home: the supervisor first, since it restarts a worker that dies.
  # Process names are cut to 15 characters, so match the full command line.
  local name pid
  for name in "Paseo Supervisor" "Paseo Daemon"; do
    for pid in $(pgrep -f "^$name\$" || true); do
      if tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "PASEO_HOME=$home"; then
        log "  $name (pid $pid) still running, stopping it"
        stop_pid "$pid"
      fi
    done
  done
}

# Electron's single-instance lock points at "<hostname>-<pid>" of the running window.
window_pid() {
  local target pid
  target="$(readlink "$1/SingletonLock" 2>/dev/null)" || return 1
  pid="${target##*-}"
  [[ "$(ps -o args= -p "$pid" 2>/dev/null)" == *Paseo.bin* ]] || return 1
  echo "$pid"
}

log "Stopping the daemons"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher home _ <<<"$target"
  log " $launcher ($home)"
  stop_daemon "$home"
done

log "Closing the windows"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher _ config <<<"$target"
  if pid="$(window_pid "$config")"; then
    log " $launcher (pid $pid)"
    stop_pid "$pid"
  else
    log " $launcher is not open"
  fi
done

# An open window may have restarted its daemon between the two steps.
log "Checking that no daemon came back"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher home _ <<<"$target"
  stop_daemon "$home"
done

log "Reopening"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher _ _ <<<"$target"
  setsid -f gtk-launch "$launcher" >/dev/null 2>&1 </dev/null
  log " $launcher"
done
log "Done"
