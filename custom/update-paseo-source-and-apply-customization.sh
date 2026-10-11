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
  --install       After building, install the app into a new folder under
                  PASEO_BUILDS_DIR and point the Paseo launchers at it. Running
                  apps and daemons keep using their old folder, so nothing has to
                  be closed first. Reopen the Paseo window to get the new app.
  --install-only  Install the last build without fetching, rebasing, or building.
  -h, --help      Show this help.

Environment:
  CUSTOM_BRANCH       Branch holding the customizations (default: custom)
  CUSTOM_BACKUP_REMOTE  Remote that receives the rebased branch after each update (default: fork)
  PASEO_BUILDS_DIR    Where installed builds live (default: ~/Applications/Paseo-builds)
  PASEO_LAUNCHERS     Space-separated .desktop files to repoint
                      (default: ~/.local/share/applications/paseo*.desktop)
  PASEO_HOMES         Space-separated daemon homes to check for the custom plugins
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
INSTALL_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
    --continue) CONTINUE=true; shift ;;
    --no-verify) VERIFY=false; shift ;;
    --no-build) BUILD=false; shift ;;
    --install) INSTALL=true; shift ;;
    --install-only) INSTALL_ONLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

BRANCH="${CUSTOM_BRANCH:-custom}"
BACKUP_REMOTE="${CUSTOM_BACKUP_REMOTE:-fork}"
BUILDS_DIR="${PASEO_BUILDS_DIR:-$HOME/Applications/Paseo-builds}"
LAUNCHERS="${PASEO_LAUNCHERS:-$(ls "$HOME"/.local/share/applications/paseo*.desktop 2>/dev/null || true)}"
RELEASE_DIR="$ROOT/packages/desktop/release/linux-unpacked"
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

# Copies the build into its own folder and repoints the launchers. Never touches a folder an
# app or daemon is running from: a running daemon keeps its old files, and the next app launch
# reuses it as long as the version matches.
install_build() {
  [[ -x "$RELEASE_DIR/Paseo" ]] || die "No build at $RELEASE_DIR. Run without --install-only first."
  local target
  target="$BUILDS_DIR/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
  step "Installing into $target"
  mkdir -p "$BUILDS_DIR"
  cp -a "$RELEASE_DIR" "$target"
  # A full build leaves package-type=rpm in linux-unpacked (the last package electron-builder
  # made), and the auto-updater would pkexec zypper to replace this build with upstream's RPM on
  # quit. Without the file it falls back to the AppImage updater, which stays off outside an
  # AppImage. The script's own dir-only build writes no package-type; this covers a full build.
  rm -f "$target/resources/package-type"

  local launcher
  for launcher in $LAUNCHERS; do
    [[ -f "$launcher" ]] || continue
    cp "$launcher" "$launcher.bak"
    # Replace the quoted path to the Paseo binary on Exec lines only.
    sed -E -i "/^Exec=/ s#\"[^\"]*/Paseo\"#\"$target/Paseo\"#" "$launcher"
    echo "  $launcher -> $(grep -o '"[^"]*/Paseo"' "$launcher" | head -1)"
  done
  command -v update-desktop-database >/dev/null &&
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

  step "Removing old builds that nothing runs from"
  local old
  while IFS= read -r old; do
    [[ -n "$old" && "$old" != "$target" ]] || continue
    if pgrep -f "$old/" >/dev/null; then
      echo "  keeping $old (in use)"
    else
      rm -rf "$old" && echo "  removed $old"
    fi
  done < <(ls -1dt "$BUILDS_DIR"/*/ 2>/dev/null | sed 's#/$##' | tail -n +3)

  echo
  echo "Installed. Close and reopen the Paseo window(s) to use it. Launchers were backed up as"
  echo "<file>.desktop.bak; restore one to roll back."
  if [[ -d "$HOME/Applications/Paseo" ]] && ! pgrep -f "$HOME/Applications/Paseo/" >/dev/null; then
    echo "The original ~/Applications/Paseo is no longer used; you can delete it."
  fi
}

if $INSTALL_ONLY; then
  install_build
  exit 0
fi

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

# Back up the rebased branch to your fork. The rebase rewrote the commits, so this force-pushes,
# but only over the state this checkout last saw on the fork.
if git remote get-url "$BACKUP_REMOTE" >/dev/null 2>&1; then
  step "Backing up $BRANCH to $BACKUP_REMOTE"
  git push --force-with-lease "$BACKUP_REMOTE" "$BRANCH" ||
    warn "Push to $BACKUP_REMOTE failed; run: git push --force-with-lease $BACKUP_REMOTE $BRANCH"
else
  warn "No '$BACKUP_REMOTE' remote; customizations exist only on this machine. See custom/README.md."
fi

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
  npx vitest run custom/plugins/shell-command custom/plugins/workspace-tasks custom/plugins/beautiful-chat packages/app/src/plugins/client-slash-commands/model.test.ts packages/app/src/file-explorer/folder-links.test.ts --bail=1
  (cd packages/server && npx vitest run src/server/plugins/custom-shell-command-plugin.e2e.test.ts src/server/plugins/custom-workspace-tasks-plugin.e2e.test.ts src/server/plugins/custom-warp-plugin.e2e.test.ts --bail=1)
  (cd custom/plugins/workboard && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npx tsc --noEmit && npx vitest run --bail=1)
  (cd packages/app && npx vitest run src/workspace-tabs/bottom-panel.test.ts --bail=1)
  (cd packages/app && npx vitest run src/agent-stream/chat-images/model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/file-pane/html-preview-assets.test.ts --bail=1)
  (cd packages/app && npx vitest run src/model-picker/model.test.ts src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts --bail=1)
  (cd packages/app && npx vitest run src/screens/workspace/workspace-tab-menu.test.ts --bail=1)
  (cd packages/app && npx vitest run --project browser src/file-pane/html-preview-assets.browser.test.ts src/file-pane/html-preview-keys.browser.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/file-explorer/service.test.ts src/server/file-explorer/service.posix.test.ts --bail=1)
fi

step "Building the desktop app"
# Only the unpacked app: install_build copies linux-unpacked and nothing else. The packages
# electron-builder.yml also lists (AppImage, deb, rpm, tar.gz) cost minutes, and rpm fails
# outright on machines without rpmbuild (Ubuntu).
npm run build:desktop -- --linux dir
[[ -x "$RELEASE_DIR/Paseo" ]] || die "Build finished but $RELEASE_DIR/Paseo is missing."

if $INSTALL; then
  install_build
else
  echo "Built: $RELEASE_DIR"
  echo "Install it with: custom/update-paseo-source-and-apply-customization.sh --install-only"
fi

# ---------------------------------------------------------------------------
# 4. Check plugin registration
# ---------------------------------------------------------------------------
step "Checking the custom plugins on each daemon"
for plugin in shell-command workspace-tasks warp; do
  plugin_dir="$ROOT/custom/plugins/$plugin"
  for home in $HOMES; do
    config="$home/config.json"
    [[ -f "$config" ]] || continue
    if node -e '
      const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const p = c.plugins?.[process.argv[3]];
      process.exit(c.pluginsEnabled === true && p?.enabled !== false && p?.path === process.argv[2] ? 0 : 1);
    ' "$config" "$plugin_dir" "$plugin"; then
      echo "  $home: $plugin installed (the daemon recompiles it from source on start)"
    else
      warn "$home: $plugin plugin not set up. See 'One-time setup' in custom/README.md."
    fi
  done
done

step "Done"
