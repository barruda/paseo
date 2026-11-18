#!/usr/bin/env bash
# CUSTOM(worktree-shared-deps): first step of paseo.json's worktree setup, in place of `npm ci`.
#
# A full `npm ci` costs ~5 GB per worktree (ext4: no reflinks). When the worktree's lockfile,
# root package.json and patches match the source checkout's, this copies the source's
# node_modules folders with hardlinks instead: real directories (git ignores them as usual,
# unlike a symlink), files shared with the source, ~0 extra bytes, a few seconds. The
# @getpaseo/* workspace links are relative, so they resolve to this worktree's own packages/.
# Anything else falls back to `npm ci`.
#
# Shared inodes mean an in-place write to a file under node_modules lands in both checkouts.
# npm ci / npm install never do that (they unlink or rename first); the hidden lockfile and the
# tool caches (.cache, .vite) are the files that get rewritten in place, so they are not shared.
#
# Env (set by the Paseo daemon for setup scripts): PASEO_SOURCE_CHECKOUT_PATH, PASEO_WORKTREE_PATH.
# PASEO_WORKTREE_DEPS=install forces `npm ci`.
set -euo pipefail

dst="${PASEO_WORKTREE_PATH:-$PWD}"
src="${PASEO_SOURCE_CHECKOUT_PATH:-}"

log() { printf '[worktree-deps] %s\n' "$*"; }

full_install() {
  log "$1: running npm ci"
  cd "$dst"
  exec npm ci
}

same_file() { cmp -s "$1" "$2"; }
same_tree() {
  # Both missing counts as equal.
  if [[ ! -e "$1" && ! -e "$2" ]]; then return 0; fi
  diff -rq "$1" "$2" >/dev/null 2>&1
}

# Hardlink-copies $1/node_modules to $2/node_modules, then unshares the files tools rewrite in place.
link_node_modules() {
  local from="$1/node_modules" to="$2/node_modules"
  rm -rf "$to"
  cp -al "$from" "$to"
  local entry
  for entry in .cache .vite .vite-temp; do
    rm -rf "${to:?}/$entry"
  done
  if [[ -f "$from/.package-lock.json" ]]; then
    cp --remove-destination "$from/.package-lock.json" "$to/.package-lock.json"
  fi
}

[[ "${PASEO_WORKTREE_DEPS:-}" == "install" ]] && full_install "PASEO_WORKTREE_DEPS=install"
[[ -n "$src" && -d "$src" ]] || full_install "no source checkout"
src="$(realpath "$src")"
dst="$(realpath "$dst")"
[[ "$src" != "$dst" ]] || full_install "source checkout is this folder"
[[ -d "$src/node_modules" ]] || full_install "source checkout has no node_modules"
[[ "$(stat -c %d "$src")" == "$(stat -c %d "$dst")" ]] || full_install "source checkout is on another filesystem"

for f in package-lock.json package.json scripts/postinstall-patches.mjs; do
  same_file "$src/$f" "$dst/$f" || full_install "$f differs from the source checkout"
done
same_tree "$src/patches" "$dst/patches" || full_install "patches/ differs from the source checkout"
node "$(dirname "${BASH_SOURCE[0]}")/node-modules-in-sync.cjs" "$src" \
  || full_install "source checkout's node_modules does not match its package-lock.json"

# Root install: the root node_modules plus each workspace's own node_modules.
dirs=(.)
while IFS= read -r ws; do
  [[ -n "$ws" ]] && dirs+=("$ws")
done < <(cd "$dst" && node -e 'for (const w of require("./package.json").workspaces ?? []) console.log(w)')

if ! (
  for d in "${dirs[@]}"; do
    if [[ -d "$src/$d/node_modules" && -d "$dst/$d" ]]; then
      link_node_modules "$src/$d" "$dst/$d"
    fi
  done
); then
  for d in "${dirs[@]}"; do rm -rf "${dst:?}/$d/node_modules"; done
  full_install "hardlink copy failed"
fi
log "linked node_modules from $src (root + workspaces)"

# Custom plugins have their own lockfiles; share their install when it matches, otherwise leave
# it to whoever needs it (the old setup never installed them).
for lock in "$dst"/custom/plugins/*/package-lock.json; do
  [[ -f "$lock" ]] || continue
  rel="${lock#"$dst"/}"
  plugin="$(dirname "$rel")"
  if [[ -d "$src/$plugin/node_modules" ]] && same_file "$src/$rel" "$lock" \
    && same_file "$src/$plugin/package.json" "$dst/$plugin/package.json"; then
    link_node_modules "$src/$plugin" "$dst/$plugin" && log "linked $plugin/node_modules"
  fi
done
