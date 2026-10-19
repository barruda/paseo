#!/usr/bin/env bash
# Commits everything in the Paseo checkout and the Warp checkout as "wip" and pushes both to the
# personal forks (barruda/paseo `custom`, barruda/warp `paseo`).
#
# Paseo's package-lock.json files are left out on purpose: they carry npm noise that must not be
# committed (see custom/README.md). The Warp checkout's lockfile (paseo-bridge/) is committed.
# The Paseo pre-commit hook (format, lint, typecheck) still runs; if it fails, nothing is committed
# or pushed there.
set -euo pipefail

PASEO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WARP_DIR="${PASEO_WARP_WEB_DIR:-$HOME/projetos/warp-web-custom}"

commit_and_push() {
  local dir=$1 branch=$2
  shift 2
  echo "==> $dir ($branch)"
  cd "$dir"
  local current
  current=$(git branch --show-current)
  if [[ $current != "$branch" ]]; then
    echo "error: $dir is on '$current', expected '$branch'" >&2
    exit 1
  fi
  git add -A -- . "$@"
  if git diff --cached --quiet; then
    echo "nothing to commit"
  else
    git commit -m 'wip'
  fi
  # Both branches get rebased onto upstream from time to time.
  git push --force-with-lease fork "$branch"
}

commit_and_push "$PASEO_DIR" custom ':(exclude,glob)**/package-lock.json'
commit_and_push "$WARP_DIR" paseo
