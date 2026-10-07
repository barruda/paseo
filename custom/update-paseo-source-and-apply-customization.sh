#!/usr/bin/env bash
# Pull upstream Paseo, replay our customizations (the commits on the `custom` branch) on top,
# verify them, and rebuild the desktop app. See custom/README.md.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: custom/update-paseo-source-and-apply-customization.sh [options]

  --ref <ref>     Upstream ref to rebase onto (default: origin/main). Use a tag such as
                  v0.11.0 to stay on a release instead of main.
  --continue      Finish an update that stopped on a rebase conflict, after you resolved
                  and staged the conflicted files.
  --no-verify     Skip typecheck and the customization tests.
  --no-build      Skip npm install, verification, and the desktop build (rebase only).
  --install       After building, replace the installed app (PASEO_INSTALL_DIR, default
                  ~/Applications/Paseo). Quit Paseo first. The previous copy is kept
                  as <dir>.previous.
  -h, --help      Show this help.

Environment:
  CUSTOM_BRANCH       Branch holding the customizations (default: custom)
  PASEO_INSTALL_DIR   Installed desktop app directory (default: ~/Applications/Paseo)
  PASEO_HOMES         Space-separated daemon homes to check for the shell-command plugin
                      (default: "~/.paseo ~/.paseo-telus")
EOF
}

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
if [[ -n "${CUSTOM_UPDATE_ROOT:-}" ]]; then
  ROOT="$CUSTOM_UPDATE_ROOT"
elif [[ "$(basename "$SCRIPT_DIR")" == ".git" ]]; then
  ROOT="$(dirname "$SCRIPT_DIR")"
else
  ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
fi
cd "$ROOT"
GIT_DIR_ABS="$(git rev-parse --absolute-git-dir)"
STATE_FILE="$GIT_DIR_ABS/custom-update-state"
LOG_FILE="$ROOT/custom/UPDATE-LOG.md"

# This script is itself a customization, so a rebase stopped partway can remove it from the
# working tree. Run from a copy in .git so --continue always has a script to run.
RUNNER="$GIT_DIR_ABS/custom-update.sh"
if [[ "$SCRIPT_PATH" != "$RUNNER" ]]; then
  cp "$SCRIPT_PATH" "$RUNNER"
  chmod +x "$RUNNER"
  CUSTOM_UPDATE_ROOT="$ROOT" exec "$RUNNER" "$@"
fi

REF="origin/main"
CONTINUE=false
VERIFY=true
BUILD=true
INSTALL=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
    --continue) CONTINUE=true; shift ;;
    --no-verify) VERIFY=false; shift ;;
    --no-build) BUILD=false; shift ;;
    --install) INSTALL=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

BRANCH="${CUSTOM_BRANCH:-custom}"
INSTALL_DIR="${PASEO_INSTALL_DIR:-$HOME/Applications/Paseo}"
HOMES="${PASEO_HOMES:-$HOME/.paseo $HOME/.paseo-telus}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

rebase_in_progress() {
  [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]
}

conflict_help() {
  local backup_tag
  backup_tag="$(sed -n 's/^backup=//p' "$STATE_FILE" 2>/dev/null)"
  cat >&2 <<EOF

The rebase stopped on a conflict while replaying a customization.

  1. See which customization is being applied:   git log -1 --format='%h %s' REBASE_HEAD
     Read its entry in the history (it may be missing from the working tree right now):
                                                   git show $backup_tag:custom/CHANGES.md
  2. Fix the files listed by:                      git diff --name-only --diff-filter=U
     then stage them:                              git add <files>
  3. Resume:                                       $RUNNER --continue

To give up and go back to where you were:          git rebase --abort
(The pre-update state is also saved as tag $backup_tag.)
EOF
}

# ---------------------------------------------------------------------------
# 1. Rebase onto upstream
# ---------------------------------------------------------------------------
if $CONTINUE; then
  [[ -f "$STATE_FILE" ]] || die "No interrupted update to continue."
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  if rebase_in_progress; then
    step "Continuing rebase"
    if ! GIT_EDITOR=true git rebase --continue; then
      conflict_help
      exit 1
    fi
  fi
else
  rebase_in_progress && die "A rebase is already in progress. Resolve it and run with --continue, or run: git rebase --abort"
  current="$(git branch --show-current)"
  [[ "$current" == "$BRANCH" ]] || die "Check out the '$BRANCH' branch first (currently on '${current:-detached HEAD}')."

  # npm rewrites optional-dependency metadata in the lockfile on install; that diff is noise.
  if [[ -n "$(git status --porcelain --untracked-files=no -- package-lock.json)" ]]; then
    warn "Discarding local npm noise in package-lock.json"
    git checkout -- package-lock.json
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    git status --short >&2
    die "Working tree has uncommitted changes. Commit them to '$BRANCH' (see custom/README.md) or stash them first."
  fi

  backup="custom-backup/$(date +%Y%m%d-%H%M%S)"
  step "Saving current state as tag $backup"
  git tag "$backup"

  step "Fetching upstream"
  git fetch origin --tags --prune
  git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || die "Unknown ref: $REF"

  old_base="$(git merge-base HEAD "$REF")"
  printf 'backup=%s\nold_base=%s\nref=%s\n' "$backup" "$old_base" "$REF" > "$STATE_FILE"

  step "Replaying customizations onto $REF ($(git rev-parse --short "$REF"))"
  git log --format='    %h %s' "$old_base..HEAD"
  # rerere remembers how you resolved a conflict and re-applies it on the next update.
  git config rerere.enabled true
  git config rerere.autoUpdate true
  if ! git rebase "$REF"; then
    conflict_help
    exit 1
  fi
fi

# shellcheck disable=SC1090
source "$STATE_FILE"
new_base="$(git rev-parse "$ref")"

# ---------------------------------------------------------------------------
# 2. Record the update
# ---------------------------------------------------------------------------
if [[ "$old_base" != "$new_base" ]]; then
  step "Recording update in custom/UPDATE-LOG.md"
  [[ -f "$LOG_FILE" ]] ||
    printf '# Update log\n\nWritten by update-paseo-source-and-apply-customization.sh. Newest last.\n' >"$LOG_FILE"
  {
    printf '\n## %s\n\n' "$(date '+%Y-%m-%d %H:%M')"
    printf -- '- Upstream: `%s` → `%s` (%s, %s)\n' \
      "$(git rev-parse --short "$old_base")" "$(git rev-parse --short "$new_base")" \
      "$ref" "$(git describe --tags --abbrev=0 "$new_base" 2>/dev/null || echo 'no tag')"
    printf -- '- Upstream commits pulled: %s\n' "$(git rev-list --count "$old_base..$new_base")"
    printf -- '- Backup tag: `%s`\n' "$backup"
    printf -- '- Customizations replayed:\n'
    git log --reverse --format='  - `%h` %s' "$new_base..HEAD" -- . ':!custom/UPDATE-LOG.md'
  } >> "$LOG_FILE"
  git add "$LOG_FILE"
  git commit -q --no-verify -m "custom: record update to $(git rev-parse --short "$new_base")"
else
  step "Already on $ref; nothing new upstream"
fi
rm -f "$STATE_FILE"

if ! $BUILD; then
  step "Done (build skipped)"
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Install, verify, build
# ---------------------------------------------------------------------------
step "Installing dependencies"
npm install
git checkout -- package-lock.json 2>/dev/null || true

if $VERIFY; then
  step "Typechecking"
  npm run typecheck
  step "Running customization tests"
  npx vitest run custom/plugins/shell-command packages/app/src/plugins/client-slash-commands/model.test.ts --bail=1
  (cd packages/server && npx vitest run src/server/plugins/custom-shell-command-plugin.e2e.test.ts --bail=1)
fi

step "Building the desktop app"
npm run build:desktop
release_dir="$ROOT/packages/desktop/release/linux-unpacked"
[[ -x "$release_dir/Paseo" ]] || die "Build finished but $release_dir/Paseo is missing."

if $INSTALL; then
  step "Installing into $INSTALL_DIR"
  if pgrep -f "$INSTALL_DIR/Paseo" >/dev/null; then
    die "Paseo is running from $INSTALL_DIR. Quit it (this stops its daemon and agents), then rerun with --no-verify --install, or copy $release_dir yourself."
  fi
  rm -rf "$INSTALL_DIR.previous"
  [[ -d "$INSTALL_DIR" ]] && mv "$INSTALL_DIR" "$INSTALL_DIR.previous"
  cp -a "$release_dir" "$INSTALL_DIR"
  echo "Installed. Previous version kept at $INSTALL_DIR.previous"
else
  echo "Built: $release_dir"
  echo "Rerun with --install (Paseo closed) to replace $INSTALL_DIR."
fi

# ---------------------------------------------------------------------------
# 4. Check plugin registration
# ---------------------------------------------------------------------------
step "Checking the shell-command plugin on each daemon"
plugin_dir="$ROOT/custom/plugins/shell-command"
for home in $HOMES; do
  config="$home/config.json"
  [[ -f "$config" ]] || continue
  if node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const p = c.plugins?.["shell-command"];
    process.exit(c.pluginsEnabled === true && p?.enabled !== false && p?.path === process.argv[2] ? 0 : 1);
  ' "$config" "$plugin_dir"; then
    echo "  $home: installed (the daemon recompiles it from source on start)"
  else
    warn "$home: shell-command plugin not set up. See 'One-time setup' in custom/README.md."
  fi
done

step "Done"
