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
  # The app and CLI read @getpaseo/client from dist (cli-dictation adds an export there).
  npm run build:client
  npm run typecheck
  step "Running customization tests"
  (cd packages/app && npx vitest run src/composer/input/state.test.ts --bail=1)
  # Ruby syntax highlighting.
  (cd packages/highlight && npx vitest run src/__tests__/parsers.test.ts src/__tests__/highlighter.test.ts --bail=1)
  (cd packages/desktop && npx vitest run src/features/opener.test.ts --bail=1)
  (cd packages/app && npx vitest run src/keyboard/shortcut-help-search.test.ts --bail=1)
  npm run test:e2e:renderer --workspace=@getpaseo/desktop -- e2e/keyboard-shortcut-unassign.spec.ts --grep 'sidebar shortcut settings|shortcut settings search' --workers=1
  (cd packages/app && npx vitest run src/voice/sidebar/session.test.ts --bail=1)
  (cd packages/app && npx vitest run src/content-width-boost/store.test.ts --bail=1)
  # The chat's scroll arrows fade after 3 s without scrolling; scrolling up shows a top arrow.
  (cd packages/app && npx vitest run src/agent-stream/scroll-arrows.test.ts --bail=1)
  (cd packages/app && npx vitest run src/keyboard/voice-escape.test.ts src/composer/submission/writer.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/agent/providers/codex-app-server-agent.test.ts --bail=1)
  (cd packages/app && npx vitest run src/composer/project-icon-model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/composer/empty-shortcuts.test.ts --bail=1)
  (cd packages/app && npx vitest run src/composer/empty-voice-trigger.test.ts --bail=1)
  npx vitest run custom/plugins/shell-command custom/plugins/workspace-tasks custom/plugins/beautiful-chat custom/plugins/tldr custom/plugins/btw packages/app/src/plugins/client-slash-commands/model.test.ts packages/app/src/shell-command-composer/model.test.ts packages/app/src/file-explorer/folder-links.test.ts --bail=1
  (cd packages/server && npx vitest run src/server/agent-status-summary.test.ts src/server/lean-claude.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/worktree-merge-status.test.ts --bail=1)
  # The status summary survives daemon restarts; New Agent tab names; pinned tabs.
  (cd packages/server && npx vitest run src/server/agent/agent-storage.test.ts -t "keeps the status summary" --bail=1)
  (cd packages/app && npx vitest run src/panels/agent-panel-descriptor.test.tsx src/tab-pins/model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/draft-worktree/model.test.ts src/composer/worktree-pill-model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/projects/remove-project-section.test.tsx --bail=1)
  (cd packages/server && npx vitest run src/server/paseo-worktree-service.test.ts -t "keeps a branch name the caller typed|worktrees folder beside the project" src/utils/project-worktrees-root.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/plugins/custom-shell-command-plugin.e2e.test.ts src/server/plugins/custom-workspace-tasks-plugin.e2e.test.ts src/server/plugins/custom-warp-plugin.e2e.test.ts src/server/plugins/custom-btw-plugin.e2e.test.ts --bail=1)
  (cd custom/plugins/power-workboard && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npx tsc --noEmit && npx vitest run --bail=1)
  (cd packages/app && npx vitest run src/workspace-tabs/bottom-panel.test.ts --bail=1)
  (cd packages/app && npx vitest run src/agent-stream/chat-images/model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/file-pane/html-preview-assets.test.ts src/file-pane/html-preview-navigation.test.ts --bail=1)
  (cd packages/app && npx vitest run src/model-picker/model.test.ts src/model-picker/project.test.ts src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts src/desktop/browser/shortcuts.test.ts --bail=1)
  (cd packages/app && npx vitest run src/screens/workspace/workspace-tab-menu.test.ts src/screens/workspace/tab-file-path.test.ts --bail=1)
  (cd packages/app && npx vitest run src/components/sidebar/done-task-archive.test.ts --bail=1)
  (cd packages/app && npx vitest run src/active-workspace-cycle/model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/sidebar-workspace-limit/model.test.ts --bail=1)
  (cd packages/app && npx vitest run src/header-shortcuts/fit.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/session.create-agent-title.test.ts --bail=1)
  # Hovering an image thumbnail shows it magnified.
  (cd packages/app && npx vitest run src/attachments/attachment-thumbnail-zoom-size.test.ts --bail=1)
  # Chat file links resolve against the session's files and get a hover card of actions.
  (cd packages/app && npx vitest run src/assistant-file-links/session-paths.test.ts src/assistant-file-links/hover-actions-model.test.ts src/components/shell-output-files.test.ts --bail=1)
  # Ctrl+Tab stays in a page in the bottom panel.
  (cd packages/app && npx vitest run src/workspace-tabs/bottom-panel-browser.test.ts --bail=1)
  # A new bottom panel opens Warp.
  (cd packages/app && npx vitest run src/workspace-tabs/bottom-panel-default.test.ts --bail=1)
  # Ctrl+J crosses ahead of the page in browser tabs.
  (cd packages/app && npx vitest run src/desktop/browser/shortcuts.test.ts --bail=1)
  (cd packages/desktop && npx vitest run src/features/browser-keyboard/policy.test.ts --bail=1)
  # Warp tabs without the browser toolbar.
  (cd packages/app && npx vitest run src/desktop/browser/store/state.test.ts src/plugins/host-navigation.test.ts --bail=1)
  (cd packages/desktop && npx vitest run src/features/browser-keyboard/index.test.ts --bail=1)
  # Tasks/Desks persistence, cross-project references, workspace fallback, and closing tabs of
  # terminals that are gone.
  (cd packages/app && npx vitest run src/task-navigation/model.test.ts src/task-navigation/store.test.ts src/workspace-tabs/open-supporting-view.test.ts --bail=1)
  npm run test:e2e:renderer --workspace=@getpaseo/desktop -- e2e/task-navigation.spec.ts --workers=1
  (cd packages/app && npx vitest run src/screens/new-workspace/bottom-terminal.test.ts --bail=1)
  (cd packages/app && npx vitest run --project browser src/file-pane/html-preview-assets.browser.test.ts src/file-pane/html-preview-keys.browser.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/file-explorer/service.test.ts src/server/file-explorer/service.posix.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/speech/providers/local/local-speech-gpu.test.ts src/server/speech/providers/local/model-files.test.ts src/server/speech/speech-config-resolver.test.ts src/server/speech/speech-settings-service.test.ts src/server/daemon-config-store.test.ts src/server/voice-config.test.ts src/server/speech/providers/local/sherpa/silero-vad-session.test.ts src/server/session/voice/voice-session.test.ts src/server/session/voice/voice-turn-controller.test.ts --bail=1)
  (cd packages/app && npx vitest run src/screens/settings/voice src/voice src/i18n/resources.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/agent/tts-manager.test.ts src/server/agent/mcp-server.test.ts --bail=1)
  (cd packages/app && npx vitest run src/chat-esc-focus/model.test.ts --bail=1)
  # History searches become tabs.
  (cd packages/app && npx vitest run src/workspace-tabs/identity.test.ts --bail=1)
  # A comment on response text lands in the composer.
  (cd packages/app && npx vitest run src/chat-comments/model.test.ts --bail=1)
  # Commit only the files checked in the Changes tree.
  (cd packages/app && npx vitest run src/git/commit-selection/model.test.ts --bail=1)
  (cd packages/server && npx vitest run src/utils/checkout-git.test.ts -t "commitChanges with paths" --bail=1)
  # Workspace diff stat counts uncommitted work only.
  (cd packages/server && npx vitest run src/utils/checkout-git.test.ts -t "shortstat|git status shows|repository without commits" src/utils/checkout-git-ref-derived.test.ts --bail=1)
  (cd packages/app && npx playwright test --project=browser e2e/browser/changes-commit-selection.spec.ts)
  # Changes file clicks reuse the open diff tab unless "Open in different tabs" is checked.
  (cd packages/app && npx vitest run src/git/diff-tabs/model.test.ts --bail=1)
  (cd packages/app && npx playwright test --project=browser e2e/browser/changes-diff-tab.spec.ts)
  # Changes opens on Uncommitted even on a clean checkout.
  (cd packages/app && npx vitest run src/git/working-diff-comparison/state.test.ts src/git/checkout-status-cache.test.ts --bail=1)
  (cd packages/app && npx playwright test --project=browser e2e/browser/changes-pane.spec.ts -g "Uncommitted for a clean checkout|expires a manual comparison|empty Changes comparison")
  # Changes clicks open the diff in the main content, with the comparison menu.
  (cd packages/app && npx playwright test --project=browser e2e/browser/changes-pane.spec.ts -g "keeps review navigation and controls")
  (cd packages/app && npx vitest run src/chat-code-run/model.test.ts --bail=1)
  (cd packages/desktop && npx vitest run src/features/media-pause.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/history-content-index.test.ts src/server/agent-history-search.test.ts src/server/history-ai-search.test.ts --bail=1)
  (cd packages/protocol && npx vitest run src/search/history-query.test.ts --bail=1)
  (cd packages/cli && npx vitest run src/commands/speech/shared.test.ts --bail=1)
  (cd packages/client && npx vitest run src/wake-dictation.test.ts --bail=1)
  # The + menu's Agent flyout (its browser check is in e2e/task-navigation.spec.ts).
  (cd packages/app && npx vitest run src/new-agent-projects/model.test.ts --bail=1)
  # The Explorer toggle sits in the top-right pane's tab row (its e2e check is in
  # e2e/task-navigation.spec.ts).
  (cd packages/app && npx vitest run src/components/split-container-top-right.test.ts --bail=1)
  # No "finished" notification while a Monitor or background subagent will wake the agent.
  (cd packages/server && npx vitest run src/server/agent/providers/claude/wake-tasks.test.ts --bail=1)
  (cd packages/server && npx vitest run src/server/agent/agent-manager.test.ts -t "waiting on a Monitor" --bail=1)
  # The bottom panel's ⌄⌄ button is checked in e2e/task-navigation.spec.ts.
  # Compact, Newspaper and Cards reading modes.
  (cd packages/app && npx vitest run src/agent-stream/reading-modes/model.test.ts src/agent-stream/reading-modes/column-flow.test.ts --bail=1)
  # Desk tabs in free rows (dragging into the second row is checked in e2e/task-navigation.spec.ts).
  (cd packages/app && npx vitest run src/tab-lanes/model.test.ts --bail=1)
  # The Flexible tab movement desktop setting (flexible-tabs).
  (cd packages/desktop && npx vitest run src/settings/desktop-settings.test.ts --bail=1)
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
for plugin in shell-command workspace-tasks warp btw; do
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

# Power Workboard is on by default: a home with plugins enabled and no entry for it gets it
# installed. An entry the user disabled stays as it is.
workboard_dir="$ROOT/custom/plugins/power-workboard"
for home in $HOMES; do
  config="$home/config.json"
  [[ -f "$config" ]] || continue
  state="$(node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const p = c.plugins?.["power-workboard"];
    console.log(c.pluginsEnabled !== true ? "plugins-off" : !p ? "missing" : p.enabled === false ? "disabled" : "ok");
  ' "$config")"
  case "$state" in
    ok) echo "  $home: power-workboard installed" ;;
    disabled) echo "  $home: power-workboard disabled by the user; left off" ;;
    plugins-off) warn "$home: plugins are off, so Power Workboard is not available there." ;;
    missing)
      if npx tsx packages/cli/src/index.js plugin ls --home "$home" >/dev/null 2>&1; then
        npx tsx packages/cli/src/index.js plugin install "$workboard_dir" --home "$home" >/dev/null &&
          echo "  $home: power-workboard installed" ||
          warn "$home: installing power-workboard failed. See 'One-time setup' in custom/README.md."
      else
        # A stopped daemon reads its plugin sources from config.json when it starts.
        node -e '
          const fs = require("fs");
          const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          c.plugins = { ...c.plugins, "power-workboard": { source: "directory", path: process.argv[2], enabled: true } };
          fs.writeFileSync(process.argv[1], JSON.stringify(c, null, 2) + "\n");
        ' "$config" "$workboard_dir" && echo "  $home: power-workboard added; it starts with the daemon"
      fi
      ;;
  esac
done

# The CUDA libraries must match the sherpa-onnx-node version the app bundles.
cuda_dir="${PASEO_CUDA_ROOT:-$HOME/.local/share/paseo-cuda}/lib"
if [[ -f "$cuda_dir/SHERPA_VERSION" ]]; then
  bundled="$(node -p "require('$ROOT/node_modules/sherpa-onnx-linux-x64/package.json').version")"
  if [[ "$(cat "$cuda_dir/SHERPA_VERSION")" != "$bundled" ]]; then
    warn "Local speech GPU libraries are for sherpa-onnx $(cat "$cuda_dir/SHERPA_VERSION"); the app now bundles $bundled. Run custom/local-speech-gpu/setup.sh."
  fi
fi

step "Done"
