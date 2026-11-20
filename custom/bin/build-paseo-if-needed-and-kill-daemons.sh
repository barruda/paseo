#!/usr/bin/env bash
# Build and install Paseo first when the installed build is behind the committed source
# (custom/bin/paseo-build.sh status), then stop the Paseo daemons (~/.paseo and ~/.paseo-telus),
# close the Paseo windows that are open, and reopen them from their launchers. paseo-telus is left
# alone when neither its window nor its daemon is running. Every step waits at most 5 s before
# killing. This stops every running agent on the daemons it restarts, then sends each one a
# "continue" once its daemon is back (paseo-restart-resume.sh). A failed build stops nothing.
#
#   --no-build          Restart without checking the build.
#   --force-build       Build and install even when the installed build is up to date.
#   --skip-agent <id>   Never resume this agent. The agent that ran this script is skipped
#                       automatically through PASEO_AGENT_ID, so its "continue" cannot make it
#                       restart Paseo again.
#
# Also linked as kill-paseos-and-daemons.sh and restart-paseos-and-daemons.sh.
#
# It detaches first: run from a Paseo terminal or a `!` command, it is a child of the daemon it
# is about to stop. Follow along in the log it prints.
set -euo pipefail

TIMEOUT=5
STATE="${XDG_STATE_HOME:-$HOME/.local/state}"
LOG="$STATE/kill-paseos-and-daemons.log"
RESUME_STATE="$STATE/paseo-restart-resume.tsv"
SKIP_STATE="$STATE/paseo-restart-skip.json"
SELF="$(readlink -f "$0")"
PASEO_BUILD="$(dirname "$SELF")/paseo-build.sh"
PASEO_RESUME="$(dirname "$SELF")/paseo-restart-resume.sh"

# Run the work in a transient user service, outside every Paseo: run from a Paseo terminal or a
# `!` command, this script is a child of the daemon it is about to stop, and setsid alone would
# leave it in that Paseo's cgroup. The service is marked by an argument, never by an environment
# variable: the windows it reopens inherit its environment, and a leaked marker made the next run
# skip this step and die with the daemon. The fixed unit name refuses a second run while one is
# still going. KillMode=process keeps whatever the reopen leaves behind alive when it exits.
if [[ "${1:-}" != --in-service ]]; then
  build=check
  # CUSTOM(restart-resume): never resume the agent that asked for the restart.
  skip_agents=()
  [[ -n "${PASEO_AGENT_ID:-}" ]] && skip_agents+=("$PASEO_AGENT_ID")
  while (( $# )); do
    case "$1" in
      --no-build) build=no; shift ;;
      --force-build) build=build; shift ;;
      --skip-agent)
        [[ -n "${2:-}" ]] || { echo "--skip-agent needs an agent id" >&2; exit 2; }
        skip_agents+=("$2")
        shift 2
        ;;
      --skip-agent=*)
        skip_agents+=("${1#*=}")
        shift
        ;;
      *)
        echo "Unknown option: $1 (use --no-build, --force-build or --skip-agent <id>)" >&2
        exit 2
        ;;
    esac
  done
  skip="$(IFS=,; echo "${skip_agents[*]}")"
  if [[ "$build" == check ]]; then
    rc=0
    "$PASEO_BUILD" status || rc=$?
    case "$rc" in
      0) build=no ;;
      10) build=if-needed ;;
      *) echo "Could not tell whether the build is current; rerun with --no-build or --force-build" >&2; exit 1 ;;
    esac
  fi
  mkdir -p "$(dirname "$LOG")"
  : >"$LOG"
  if ! systemd-run --user --quiet --collect --unit=kill-paseos-and-daemons \
    -p KillMode=process -p StandardInput=null -p "StandardOutput=append:$LOG" \
    -p "StandardError=append:$LOG" -- "$SELF" --in-service "$build" "$skip"; then
    echo "Could not start the kill-paseos-and-daemons service (is a run still going?)" >&2
    exit 1
  fi
  if [[ "$build" != no ]]; then
    echo "Building and installing Paseo (a few minutes), then restarting the daemons and windows," \
      "in a systemd user service. A failed build restarts nothing. Log: $LOG"
  else
    echo "Restarting the Paseo daemons and windows in a systemd user service. Log: $LOG"
  fi
  exit 0
fi

log() { echo "[$(date +%T)] $*"; }

# The agents to leave alone: the one that ran this script, passed through the service as an
# argument because the service does not inherit the caller's environment.
SKIP_AGENTS="${3:-}"

# if-needed checks again once it holds the build lock: another build may have finished meanwhile.
if [[ "${2:-no}" != no ]]; then
  log "Building and installing Paseo ($2)"
  if ! "$PASEO_BUILD" "$2"; then
    log "FAILED: the build or install failed; nothing was stopped"
    notify-send -u critical "Paseo build failed" "Daemons not restarted. Log: $LOG" 2>/dev/null || true
    exit 1
  fi
  log "Build installed"
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

# CUSTOM(restart-resume): remember what was running before the daemons go down, so each one can
# be told to continue when its daemon is back. The skip list also goes to a file the board reads,
# so the board leaves the agent that ran this restart alone too. Recording is best effort: a
# read-only state folder must not stop the restart.
log "Recording the agents that are running"
if ! mkdir -p "$STATE"; then
  log "Could not create $STATE; the restart goes on without resuming agents"
  RESUME_STATE=""
elif ! : >"$RESUME_STATE"; then
  log "Could not reset $RESUME_STATE; the restart goes on without resuming agents"
  RESUME_STATE=""
fi
if ! bash "$PASEO_RESUME" skip "$SKIP_STATE" "$SKIP_AGENTS" | sed 's/^/  /'; then
  log "Could not record the restart skip list; the board may send a second continue"
fi
if [[ -n "$RESUME_STATE" ]]; then
  for target in "${TARGETS[@]}"; do
    IFS='|' read -r launcher home _ <<<"$target"
    if [[ -n "$(daemon_processes "$home")" ]]; then
      bash "$PASEO_RESUME" snapshot "$RESUME_STATE" "$home" "$SKIP_AGENTS" | sed 's/^/  /' ||
        log "Could not record the agents of $home; the restart goes on"
    fi
  done
fi

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
    -u PASEO_DESKTOP_NAME -u PASEO_DESKTOP_MANAGED -u PASEO_CLI -u KILL_PASEOS_DETACHED gtk-launch "$1" \
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

# CUSTOM(restart-resume): tell the agents this daemon had running to continue. The helper skips
# agents that are gone, already running, or already got a message after the restart.
resume_agents() {
  local home="$1"
  [[ -n "$RESUME_STATE" && -s "$RESUME_STATE" ]] || return 0
  bash "$PASEO_RESUME" resume "$RESUME_STATE" "$home" "$PASEO_CLI" "$SKIP_AGENTS" | sed 's/^/  /' ||
    log "Could not resume the agents of $home; the restart goes on"
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
    resume_agents "$home"
    continue
  fi
  log " $launcher did not come back in 30s (window: $(window_pid "$config" || echo none)," \
    "daemon: $(daemon_processes "$home" | tr '\n' ' ')), launching it again"
  launch "$launcher"
  if pid="$(wait_until_up "$config" "$home")"; then
    log " $launcher: window pid $pid, daemon running"
    resume_agents "$home"
  else
    log " FAILED: $launcher is still not up"
    failed=1
  fi
done
log "Done"
exit "$failed"
