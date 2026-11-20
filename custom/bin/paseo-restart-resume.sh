#!/usr/bin/env bash
# CUSTOM(restart-resume): snapshot the agents that were running before a Paseo daemon restart and
# send each one a "continue" once its daemon is back. It never stops, starts or restarts anything;
# build-paseo-if-needed-and-kill-daemons.sh calls it around the stop it already does.
#
#   paseo-restart-resume.sh skip <skip-file> [skip-id,...]
#   paseo-restart-resume.sh snapshot <state-file> <home> [skip-id,...]
#   paseo-restart-resume.sh resume <state-file> <home> <paseo-cli> [skip-id,...]
#
# `skip` writes the agents the restart must leave alone and the restart time, as
# `{"at":"<iso>","agents":[...]}`. The Power Workboard reads that file and applies the same skip
# for the same restart, so neither side sends a "continue" to the agent that ran the restart.
#
# The state file has one `home<TAB>id<TAB>agent-file<TAB>lastUserMessageAt` line per agent. An
# agent is resumed only when it still exists and nothing changed since the snapshot: a message
# already sent after the restart (by this script's caller, the board or the user) wins, and an
# agent already running again is left alone. Agents in error or waiting for permission are never
# recorded; the board's own error retry and permission wait handle them. Failures are logged and
# skipped.
#
# Env:
#   PASEO_RESTART_MESSAGE        the message sent (default below)
#   PASEO_RESTART_ATTEMPTS       tries per agent (default 5)
#   PASEO_RESTART_DELAY          seconds between tries (default 2)
#   PASEO_RESTART_READY_TIMEOUT  seconds to wait for the daemon to answer (default 60)
set -euo pipefail

MESSAGE="${PASEO_RESTART_MESSAGE:-The Paseo daemon restarted and cut your last turn. Continue from where you stopped. The restart was intentional: do not restart it again.}"
ATTEMPTS="${PASEO_RESTART_ATTEMPTS:-5}"
DELAY="${PASEO_RESTART_DELAY:-2}"
READY_TIMEOUT="${PASEO_RESTART_READY_TIMEOUT:-60}"

log() { echo "[$(date +%T)] resume: $*"; }

# A top-level string field of a stored agent record. The records are pretty-printed JSON; nested
# objects are indented deeper, so the two-space anchor keeps nested `id`s out.
field() {
  sed -n "s/^  \"$2\": \"\\([^\"]*\\)\".*/\\1/p" "$1" | head -n1
}

# A top-level boolean field, such as `requiresAttention`.
bool_field() {
  sed -n "s/^  \"$2\": \(true\|false\).*/\\1/p" "$1" | head -n1
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

write_skip() {
  local file="$1" list="${2:-}" at id first=1
  local -a ids
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! mkdir -p "$(dirname "$file")"; then
    log "could not create $(dirname "$file"); the board will not know the skip list"
    return 1
  fi
  {
    printf '{"at":"%s","agents":[' "$at"
    if [[ -n "$list" ]]; then
      IFS=',' read -r -a ids <<<"$list"
      for id in "${ids[@]}"; do
        [[ -n "$id" ]] || continue
        ((first)) || printf ','
        printf '"%s"' "$id"
        first=0
      done
    fi
    printf ']}\n'
  } >"$file" || {
    log "could not write $file; the board will not know the skip list"
    return 1
  }
}

snapshot() {
  local state="$1" home="$2" skip="${3:-}" file id status user attention reason
  [[ -d "$home/agents" ]] || return 0
  while IFS= read -r -d '' file; do
    status="$(field "$file" lastStatus)"
    case "$status" in running | initializing) ;; *) continue ;; esac
    id="$(field "$file" id)"
    if [[ -z "$id" ]]; then
      if grep -q '"id"' "$file"; then
        log "WARNING: could not read the agent id from $file; skipping it"
      fi
      continue
    fi
    attention="$(bool_field "$file" requiresAttention)"
    reason="$(field "$file" attentionReason)"
    if [[ "$attention" == true && "$reason" == permission ]]; then
      log "skip $id: it is waiting for permission"
      continue
    fi
    if skipped "$id" "$skip"; then
      log "skip $id: it must not be resumed"
      continue
    fi
    user="$(field "$file" lastUserMessageAt)"
    printf '%s\t%s\t%s\t%s\n' "$home" "$id" "$file" "${user:--}" >>"$state"
  done < <(find "$home/agents" -type f -name '*.json' -print0)
}

# The daemon's WebSocket answers before any send: `agent ls` connects and fails while the daemon
# is still starting, so retry it until READY_TIMEOUT seconds have passed.
wait_ready() {
  local home="$1" cli="$2" deadline=$((SECONDS + READY_TIMEOUT))
  while ((SECONDS < deadline)); do
    if env -u PASEO_AGENT_ID -u PASEO_HOME -u PASEO_HOST \
      "$cli" agent ls --home "$home" --json >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

resume() {
  local state="$1" home="$2" cli="$3" skip="${4:-}"
  [[ -f "$state" ]] || return 0
  if ! wait_ready "$home" "$cli"; then
    log "the daemon of $home did not answer within ${READY_TIMEOUT}s; skipping its agents"
    return 0
  fi
  local h id file snapshotUser status user attention reason attempt ok
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
      error)
        log "skip $id: it stopped with an error"
        continue
        ;;
    esac
    attention="$(bool_field "$file" requiresAttention)"
    reason="$(field "$file" attentionReason)"
    if [[ "$attention" == true && "$reason" == permission ]]; then
      log "skip $id: it is waiting for permission"
      continue
    fi
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
  skip)
    [[ $# -ge 2 ]] || {
      echo "usage: $0 skip <skip-file> [skip-id,...]" >&2
      exit 2
    }
    write_skip "$2" "${3:-}"
    ;;
  snapshot)
    [[ $# -ge 3 ]] || {
      echo "usage: $0 snapshot <state-file> <home> [skip-id,...]" >&2
      exit 2
    }
    snapshot "$2" "$3" "${4:-}"
    ;;
  resume)
    [[ $# -ge 4 ]] || {
      echo "usage: $0 resume <state-file> <home> <paseo-cli> [skip-id,...]" >&2
      exit 2
    }
    resume "$2" "$3" "$4" "${5:-}"
    ;;
  *)
    echo "usage: $0 skip|snapshot|resume ..." >&2
    exit 2
    ;;
esac
