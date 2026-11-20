#!/usr/bin/env bash
# CUSTOM(restart-resume): fixture test for paseo-restart-resume.sh. A fake `paseo` records the
# sends; nothing here stops or starts a daemon.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$here/../bin/paseo-restart-resume.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

check() {
  if eval "$2"; then
    printf 'ok   %s\n' "$1"
  else
    printf 'FAIL %s\n' "$1"
    failures=$((failures + 1))
  fi
}

agent() {
  local file="$1" id="$2" status="$3" user="${4:-null}"
  mkdir -p "$(dirname "$file")"
  cat >"$file" <<EOF
{
  "id": "$id",
  "config": {
    "id": "nested-$id"
  },
  "lastUserMessageAt": $([[ "$user" == null ]] && echo null || echo "\"$user\""),
  "lastStatus": "$status"
}
EOF
}

home="$work/home"
running="$home/agents/ws/running-1.json"
initializing="$home/agents/ws/initializing-1.json"
idle="$home/agents/ws/idle-1.json"
skipped="$home/agents/ws/skip-me.json"
trigger="$home/agents/ws/trigger.json"
agent "$running" running-1 running "2026-09-22T23:00:00.000Z"
agent "$initializing" initializing-1 initializing
agent "$idle" idle-1 idle
agent "$skipped" skip-me running
agent "$trigger" trigger running
state="$work/state.tsv"

bash "$helper" snapshot "$state" "$home" "skip-me,trigger" >/dev/null

check "snapshot keeps a running agent" 'grep -q "running-1" "$state"'
check "snapshot keeps an initializing agent" 'grep -q "initializing-1" "$state"'
check "snapshot drops an idle agent" '! grep -q "idle-1" "$state"'
check "snapshot skips an explicit skip id" '! grep -q "skip-me" "$state"'
check "snapshot skips the triggering agent" '! grep -q "trigger" "$state"'
check "snapshot records the top-level id, not a nested one" '! grep -q "nested-" "$state"'
check "snapshot records the last user message" 'grep -q "2026-09-22T23:00:00.000Z" "$state"'

cat >"$work/paseo-ok" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$work/cli.log"
EOF
chmod +x "$work/paseo-ok"
: >"$work/cli.log"

# The first agent got a message after the restart; the second is already running again.
agent "$running" running-1 idle "2026-09-23T00:05:30.000Z"
agent "$initializing" initializing-1 running
PASEO_RESTART_DELAY=0 PASEO_RESTART_ATTEMPTS=1 \
  bash "$helper" resume "$state" "$home" "$work/paseo-ok" "skip-me,trigger" >/dev/null

check "a changed last user message is not sent again" '! grep -q "running-1" "$work/cli.log"'
check "an agent already running is not sent again" '! grep -q "initializing-1" "$work/cli.log"'

# An agent that was running before the restart and is idle now gets the continue.
home2="$work/home2"
still="$home2/agents/ws/still-idle.json"
state2="$work/state2.tsv"
agent "$still" still-idle running "2026-09-22T22:00:00.000Z"
bash "$helper" snapshot "$state2" "$home2" "" >/dev/null
agent "$still" still-idle idle "2026-09-22T22:00:00.000Z"
PASEO_RESTART_DELAY=0 PASEO_RESTART_ATTEMPTS=1 \
  bash "$helper" resume "$state2" "$home2" "$work/paseo-ok" >/dev/null
check "an unchanged idle agent gets the continue" 'grep -q "agent send --home $home2 --no-wait still-idle" "$work/cli.log"'
check "the continue carries the restart message" 'grep -q "restart was intentional" "$work/cli.log"'
check "another home's agents are left alone" '! grep -q "running-1\|initializing-1" "$work/cli.log"'

# A gone agent is skipped, and a failing send is logged without stopping the run.
home3="$work/home3"
gone="$home3/agents/ws/gone.json"
failing="$home3/agents/ws/failing.json"
state3="$work/state3.tsv"
agent "$gone" gone running "2026-09-22T21:00:00.000Z"
agent "$failing" failing running "2026-09-22T21:00:00.000Z"
bash "$helper" snapshot "$state3" "$home3" "" >/dev/null
rm -f "$gone"
agent "$failing" failing idle "2026-09-22T21:00:00.000Z"
cat >"$work/paseo-fail" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$work/paseo-fail"
set +e
output="$(PASEO_RESTART_DELAY=0 PASEO_RESTART_ATTEMPTS=1 \
  bash "$helper" resume "$state3" "$home3" "$work/paseo-fail" 2>&1)"
status=$?
set -e
check "a gone agent is skipped" 'grep -q "no longer exists" <<<"$output"'
check "a failed send is logged" 'grep -q "FAILED to resume failing" <<<"$output"'
check "a failed send does not stop the helper" '[[ "$status" -eq 0 ]]'

if ((failures > 0)); then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
