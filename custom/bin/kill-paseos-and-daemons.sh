#!/usr/bin/env bash
# Stop the Paseo daemons (~/.paseo and ~/.paseo-telus), close the Paseo windows that are open,
# and reopen them from their launchers. paseo-telus is left alone when neither its window nor its
# daemon is running. Every step waits at most 5 s before killing. This stops every running agent on the daemons it restarts.
#
# It detaches first: run from a Paseo terminal or a `!` command, it is a child of the daemon it
# is about to stop. Follow along in the log it prints.
set -euo pipefail

TIMEOUT=5
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/kill-paseos-and-daemons.log"

# Detach into a transient user service. setsid alone leaves the session but not the cgroup: the
# script stayed in the systemd scope of the Paseo window that ran it and could go down with that
# Paseo halfway through, leaving paseo-personal neither killed nor reopened. KillMode=process keeps
# whatever the reopen leaves behind alive when the script exits.
if [[ -z "${KILL_PASEOS_DETACHED:-}" ]]; then
  mkdir -p "$(dirname "$LOG")"
  : >"$LOG"
  self="$(readlink -f "$0")"
  if systemd-run --user --quiet --collect --unit="kill-paseos-and-daemons-$(date +%s)" \
    -p KillMode=process -p StandardInput=null -p "StandardOutput=append:$LOG" \
    -p "StandardError=append:$LOG" --setenv=KILL_PASEOS_DETACHED=1 -- "$self" "$@"; then
    echo "Restarting the Paseo daemons and windows in a systemd user service. Log: $LOG"
  else
    echo "systemd-run failed, detaching with setsid instead" >>"$LOG"
    KILL_PASEOS_DETACHED=1 setsid -f "$self" "$@" >>"$LOG" 2>&1 </dev/null
    echo "Restarting the Paseo daemons and windows in the background. Log: $LOG"
  fi
  exit 0
fi

# launcher | daemon home | Electron user data dir | restart: always, or only if its window or
# daemon is running
ALL_TARGETS=(
  "paseo-personal|$HOME/.paseo|$HOME/.config/Paseo|always"
  "paseo-telus|$HOME/.paseo-telus|$HOME/.config/Paseo-telus|if-open"
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

# "<name>|<pid>" of each daemon process of this home, the supervisor first, since it restarts a
# worker that dies. Process names are cut to 15 characters, so match the full command line.
daemon_processes() {
  local name pid
  for name in "Paseo Supervisor" "Paseo Daemon"; do
    for pid in $(pgrep -f "^$name\$" || true); do
      if tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "PASEO_HOME=$1"; then
        echo "$name|$pid"
      fi
    done
  done
}

stop_daemon() {
  local home="$1"
  [[ -d "$home" ]] || return 0
  env -u PASEO_AGENT_ID -u PASEO_HOME "$PASEO_CLI" daemon stop --home "$home" \
    --timeout "$TIMEOUT" --force --kill-timeout 2 2>&1 | sed 's/^/  /' || true
  local name pid
  while IFS='|' read -r name pid; do
    log "  $name (pid $pid) still running, stopping it"
    stop_pid "$pid"
  done < <(daemon_processes "$home")
}

# Electron's single-instance lock points at "<hostname>-<pid>" of the running window.
window_pid() {
  local target pid
  target="$(readlink "$1/SingletonLock" 2>/dev/null)" || return 1
  pid="${target##*-}"
  [[ "$(ps -o args= -p "$pid" 2>/dev/null)" == *Paseo.bin* ]] || return 1
  echo "$pid"
}

TARGETS=()
for target in "${ALL_TARGETS[@]}"; do
  IFS='|' read -r launcher home config restart <<<"$target"
  if [[ "$restart" == if-open ]] && ! window_pid "$config" >/dev/null &&
    [[ -z "$(daemon_processes "$home")" ]]; then
    log "Skipping $launcher: neither its window nor its daemon is running"
    continue
  fi
  TARGETS+=("$target")
done

log "Stopping the daemons"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher home _ <<<"$target"
  log " $launcher ($home)"
  stop_daemon "$home"
done

log "Closing the windows"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher _ config _ <<<"$target"
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

# gtk-launch moves the window into its own app scope only after it starts, so the first processes
# the window forks stay where gtk-launch ran. Give gtk-launch a scope of its own in app.slice so
# they land there and not in this service.
launch() {
  setsid -f systemd-run --user --scope --quiet --collect --slice=app.slice \
    --unit="paseo-launch-$1-$$-$RANDOM" -- env -u ELECTRON_RUN_AS_NODE -u PASEO_HOME \
    -u PASEO_AGENT_ID -u GH_CONFIG_DIR -u CLAUDE_CONFIG_DIR -u PASEO_ELECTRON_USER_DATA_DIR \
    -u PASEO_DESKTOP_NAME -u PASEO_DESKTOP_MANAGED -u PASEO_CLI gtk-launch "$1" \
    >/dev/null 2>&1 </dev/null
}

# The window pid once the window holds its lock and its daemon is running, within 30 s.
wait_until_up() {
  local config="$1" home="$2" pid
  for _ in $(seq 150); do
    if pid="$(window_pid "$config")" && [[ -n "$(daemon_processes "$home")" ]]; then
      echo "$pid"
      return 0
    fi
    sleep 0.2
  done
  return 1
}

log "Reopening"
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher _ _ <<<"$target"
  launch "$launcher"
  log " $launcher"
done

# A reopened window has died on its own before, leaving no Paseo at all. Check, and launch once
# more if it did not come back.
log "Checking that they came back"
failed=0
for target in "${TARGETS[@]}"; do
  IFS='|' read -r launcher home config _ <<<"$target"
  if pid="$(wait_until_up "$config" "$home")"; then
    log " $launcher: window pid $pid, daemon running"
    continue
  fi
  log " $launcher did not come back in 30s (window: $(window_pid "$config" || echo none)," \
    "daemon: $(daemon_processes "$home" | tr '\n' ' ')), launching it again"
  launch "$launcher"
  if pid="$(wait_until_up "$config" "$home")"; then
    log " $launcher: window pid $pid, daemon running"
  else
    log " FAILED: $launcher is still not up"
    failed=1
  fi
done
log "Done"
exit "$failed"
