#!/usr/bin/env bash
# Build and install the desktop app from this checkout, and tell whether the installed build is
# behind the committed source.
#
#   paseo-build.sh build       Build from the working tree as it is, record its source, install.
#   paseo-build.sh if-needed   Same, only when `status` says the installed build is behind.
#   paseo-build.sh status      Exit 0 when the installed build is up to date, 10 when it is behind
#                              (prints why), 1 on error.
#   paseo-build.sh snapshot    Record the working tree as a commit and print it (for the update script).
#   paseo-build.sh stamp <dir> <commit>   Write the source record into a build folder.
#
# Each build folder carries a `paseo-build-source` file naming a snapshot commit of the working
# tree it was built from, uncommitted and untracked files included, kept alive by a ref under
# refs/paseo-builds/. A build is behind when HEAD differs from that snapshot in a file that goes
# into the app. Builds made without this script have no record; for those the commit in the
# install folder's name (HEAD at install time) stands in, which can only cause an extra build.
set -euo pipefail

ROOT="$(git -C "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" rev-parse --show-toplevel)"
cd "$ROOT"
RELEASE_DIR="$ROOT/packages/desktop/release/linux-unpacked"
STAMP=paseo-build-source
REF_PREFIX=refs/paseo-builds
KEEP_SNAPSHOTS=10
LAUNCHER="${PASEO_STATUS_LAUNCHER:-$HOME/.local/share/applications/paseo-personal.desktop}"

# Paths that don't go into the app. custom/ holds scripts, docs and the directory plugins, which
# the daemon loads from source on start.
NOT_IN_APP=(
  ':(exclude)custom' ':(exclude)docs' ':(exclude)public-docs' ':(exclude).agents'
  ':(exclude).claude' ':(exclude).github' ':(exclude)packages/website' ':(exclude)*.md'
  ':(exclude)*.test.ts' ':(exclude)*.test.tsx' ':(exclude)*/e2e/*' ':(exclude)*/__tests__/*'
)

die() { echo "paseo-build: $*" >&2; exit 1; }

snapshot() {
  local index tree commit
  index="$(mktemp)"
  cp "$(git rev-parse --git-path index)" "$index"
  GIT_INDEX_FILE="$index" git add -A
  tree="$(GIT_INDEX_FILE="$index" git write-tree)"
  rm -f "$index"
  commit="$(git commit-tree "$tree" -p HEAD -m "Paseo build snapshot")"
  git update-ref "$REF_PREFIX/$(date +%Y%m%d-%H%M%S)-${commit:0:9}" "$commit"
  git for-each-ref --sort=-refname --format='%(refname)' "$REF_PREFIX/" |
    tail -n +$((KEEP_SNAPSHOTS + 1)) | while read -r ref; do git update-ref -d "$ref"; done
  echo "$commit"
}

stamp() {
  local dir="${1:?build folder}" commit="${2:?snapshot commit}"
  printf 'source=%s\nhead=%s\nbuilt=%s\n' "$commit" "$(git rev-parse HEAD)" "$(date -Is)" >"$dir/$STAMP"
}

# The folder the launcher's Exec line runs Paseo from.
installed_dir() {
  local exec_line
  exec_line="$(grep -m1 '^Exec=' "$LAUNCHER")" || die "No Exec line in $LAUNCHER"
  dirname "$(sed -E 's/.*"([^"]+\/Paseo)".*/\1/' <<<"$exec_line")"
}

# The commit the installed build was made from, or nothing when it is unknown.
installed_source() {
  local dir sha=""
  dir="$(installed_dir)"
  if [[ -f "$dir/$STAMP" ]]; then
    sha="$(sed -n 's/^source=//p' "$dir/$STAMP")"
  elif [[ "$(basename "$dir")" =~ -([0-9a-f]{7,40})$ ]]; then
    sha="${BASH_REMATCH[1]}"
  fi
  [[ -n "$sha" ]] && git rev-parse -q --verify "$sha^{commit}" 2>/dev/null || true
}

status() {
  local dir source changed
  dir="$(installed_dir)"
  source="$(installed_source)"
  if [[ -z "$source" ]]; then
    echo "Installed build $dir: source unknown, rebuild needed."
    return 10
  fi
  changed="$(git diff --name-only "$source" HEAD -- . "${NOT_IN_APP[@]}")"
  if [[ -z "$changed" ]]; then
    echo "Installed build is up to date with HEAD ($(git rev-parse --short HEAD)): $dir"
    return 0
  fi
  echo "Installed build is behind HEAD ($(git rev-parse --short HEAD)): $dir"
  echo "  built from ${source:0:9}; $(git rev-list --count "$source..HEAD") commit(s) since," \
    "$(wc -l <<<"$changed") app file(s) changed:"
  head -10 <<<"$changed" | sed 's/^/    /'
  (($(wc -l <<<"$changed") <= 10)) || echo "    ..."
  return 10
}

build() {
  [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]] &&
    die "A rebase is in progress; finish it before building."
  git rev-parse -q --verify MERGE_HEAD >/dev/null && die "A merge is in progress; finish it before building."

  # A systemd service or a desktop shortcut has no nvm on PATH.
  if ! command -v npm >/dev/null; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [[ -s "$NVM_DIR/nvm.sh" ]] || die "npm not found and no nvm at $NVM_DIR"
    set +eu
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use --silent default >/dev/null
    set -eu
    command -v npm >/dev/null || die "npm not found after loading nvm"
  fi

  local source commit
  source="$(installed_source)"
  if [[ -z "$source" ]] || [[ -n "$(git diff --name-only "$source" HEAD -- package.json package-lock.json 'packages/*/package.json')" ]]; then
    echo "== Installing dependencies"
    npm install --no-audit --no-fund
    # npm rewrites optional-dependency metadata in the lockfile on install; that diff is noise.
    git checkout -- package-lock.json 2>/dev/null || true
  fi

  commit="$(snapshot)"
  echo "== Building the desktop app from $(git rev-parse --short HEAD) plus the working tree (snapshot ${commit:0:9})"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "   Uncommitted files in the build:"
    git status --short | sed 's/^/     /'
  fi
  # Only the unpacked app: the install copies linux-unpacked and nothing else.
  npm run build:desktop -- --linux dir
  [[ -x "$RELEASE_DIR/Paseo" ]] || die "Build finished but $RELEASE_DIR/Paseo is missing."
  stamp "$RELEASE_DIR" "$commit"
  echo "== Installing"
  custom/update-paseo-source-and-apply-customization.sh --install-only
}

case "${1:-}" in
  build) build ;;
  if-needed)
    if status; then exit 0; fi
    build
    ;;
  status) status ;;
  snapshot) snapshot ;;
  stamp) stamp "${2:-}" "${3:-}" ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
