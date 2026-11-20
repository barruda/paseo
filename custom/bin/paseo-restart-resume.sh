#!/usr/bin/env bash
# CUSTOM(restart-resume): snapshot the agents that were running before a Paseo daemon restart and
# send each one a "continue" once its daemon is back. It never stops, starts or restarts anything;
# build-paseo-if-needed-and-kill-daemons.sh calls it around the stop it already does.
#
#   paseo-restart-resume.sh snapshot <state-file> <home> [skip-id,...]
#   paseo-restart-resume.sh resume <state-file> <home> <paseo-cli> [skip-id,...]
#
# The state file has one `home<TAB>id<TAB>agent-file<TAB>lastUserMessageAt` line per agent. An
# agent is resumed only when it still exists and nothing changed since the snapshot: a message
# already sent after the restart (by this script's caller, the board or the user) wins, and an
# agent already running again is left alone. Failures are logged and skipped.
#
# Env:
#   PASEO_RESTART_MESSAGE   the message sent (default below)
#   PASEO_RESTART_ATTEMPTS  tries per agent (default 3)
#   PASEO_RESTART_DELAY     seconds between tries (default 2)
set -euo pipefail

MESSAGE="${PASEO_RESTART_MESSAGE:-The Paseo daemon restarted and cut your last turn. Continue from where you stopped. The restart was intentional: do not restart it again.}"
ATTEMPTS="${PASEO_RESTART_ATTEMPTS:-3}"
DELAY="${PASEO_RESTART_DELAY:-2}"

log() { echo "[$(date +%T)] resume: $*"; }

# A top-level string field of a stored agent record. The records are pretty-printed JSON; nested
# objects are indented deeper, so the two-space anchor keeps nested `id`s out.
field() {
  sed -n "s/^  \"$2\": \"\\([^\"]*\\)\".*/\\1/p" "$1" | head -n1
}

skipped() {
  local id="$1" list="$2" item
  [[ -n "$list" ]] || return 1
  local -a ids
  IFS=',' read -r -a ids <<<"$list"
  for item in "${ids[@]}"; do
    [[ "$item" == "$id" ]] && return 0
  done
  return 1
}

snapshot() {
  local state="$1" home="$2" skip="${3:-}" file id status user
  [[ -d "$home/agents" ]] || return 0
  while IFS= read -r -d '' file; do
    status="$(field "$file" lastStatus)"
    case "$status" in running | initializing) ;; *) continue ;; esac
    id="$(field "$file" id)"
    [[ -n "$id" ]] || continue
    if skipped "$id" "$skip"; then
      log "skip $id: it must not be resumed"
      continue
    fi
    user="$(field "$file" lastUserMessageAt)"
    printf '%s\t%s\t%s\t%s\n' "$home" "$id" "$file" "${user:--}" >>"$state"
  done < <(find "$home/agents" -type f -name '*.json' -print0)
}

resume() {
  local state="$1" home="$2" cli="$3" skip="${4:-}"
  [[ -f "$state" ]] || return 0
  local h id file snapshotUser status user attempt ok
  while IFS=$'\t' read -r h id file snapshotUser; do
    [[ "$h" == "$home" ]] || continue
    if skipped "$id" "$skip"; then
      log "skip $id: it must not be resumed"
      continue
    fi
    if [[ ! -f "$file" ]]; then
      log "skip $id: the agent no longer exists"
      continue
    fi
    status="$(field "$file" lastStatus)"
    case "$status" in
      running | initializing)
        log "skip $id: it is already running"
        continue
        ;;
    esac
    user="$(field "$file" lastUserMessageAt)"
    user="${user:--}"
    if [[ "$user" != "$snapshotUser" ]]; then
      log "skip $id: it already got a message after the restart"
      continue
    fi
    attempt=1
    ok=no
    while ((attempt <= ATTEMPTS)); do
      if env -u PASEO_AGENT_ID -u PASEO_HOME -u PASEO_HOST \
        "$cli" agent send --home "$home" --no-wait "$id" "$MESSAGE" >/dev/null 2>&1; then
        ok=yes
        break
      fi
      attempt=$((attempt + 1))
      if ((attempt <= ATTEMPTS)); then sleep "$DELAY"; fi
    done
    if [[ "$ok" == yes ]]; then
      log "resumed $id"
    else
      log "FAILED to resume $id after $ATTEMPTS attempts"
    fi
  done <"$state"
}

case "${1:-}" in
  snapshot | resume)
    command="$1"
    shift
    if [[ "$command" == resume ]]; then
      [[ $# -ge 3 ]] || {
        echo "usage: $0 resume <state-file> <home> <paseo-cli> [skip-id,...]" >&2
        exit 2
      }
      resume "$1" "$2" "$3" "${4:-}"
    else
      [[ $# -ge 2 ]] || {
        echo "usage: $0 snapshot <state-file> <home> [skip-id,...]" >&2
        exit 2
      }
      snapshot "$1" "$2" "${3:-}"
    fi
    ;;
  *)
    echo "usage: $0 snapshot|resume ..." >&2
    exit 2
    ;;
esac
