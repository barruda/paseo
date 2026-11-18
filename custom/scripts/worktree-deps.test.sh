#!/usr/bin/env bash
# CUSTOM(worktree-shared-deps): fixture test for worktree-deps.sh. A fake `npm` records fallbacks.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

mkdir -p "$work/bin"
cat >"$work/bin/npm" <<'EOF'
#!/usr/bin/env bash
echo "$*" >"$PWD/.npm-called"
EOF
chmod +x "$work/bin/npm"

lock='{"packages":{"":{"name":"fixture"},"node_modules/left-pad":{"version":"1.0.0","resolved":"https://r/left-pad-1.0.0.tgz"},"node_modules/@fx/app":{"resolved":"packages/app","link":true},"packages/app":{"name":"@fx/app"}}}'
hidden='{"packages":{"node_modules/left-pad":{"version":"1.0.0","resolved":"https://r/left-pad-1.0.0.tgz"},"node_modules/@fx/app":{"resolved":"packages/app","link":true},"packages/app":{"name":"@fx/app"}}}'

# A checkout with package.json, lockfile and patches; $2=yes also installs node_modules.
make_checkout() {
  local dir="$1"
  mkdir -p "$dir/packages/app" "$dir/patches" "$dir/scripts" "$dir/custom/plugins/demo"
  echo '{"name":"fixture","workspaces":["packages/app"]}' >"$dir/package.json"
  echo "$lock" >"$dir/package-lock.json"
  echo 'patch' >"$dir/patches/left-pad+1.0.0.patch"
  echo '// patches' >"$dir/scripts/postinstall-patches.mjs"
  echo '{"name":"@fx/app"}' >"$dir/packages/app/package.json"
  echo '{"name":"demo"}' >"$dir/custom/plugins/demo/package.json"
  echo '{"lockfileVersion":3}' >"$dir/custom/plugins/demo/package-lock.json"
  if [[ "${2:-}" == yes ]]; then
    mkdir -p "$dir/node_modules/left-pad" "$dir/node_modules/@fx" "$dir/node_modules/.vite" \
      "$dir/packages/app/node_modules/tiny" "$dir/custom/plugins/demo/node_modules/dep"
    echo "$hidden" >"$dir/node_modules/.package-lock.json"
    echo 'module.exports = 1' >"$dir/node_modules/left-pad/index.js"
    echo '{}' >"$dir/node_modules/.vite/results.json"
    ln -s ../../packages/app "$dir/node_modules/@fx/app"
    echo 'tiny' >"$dir/packages/app/node_modules/tiny/index.js"
    echo 'dep' >"$dir/custom/plugins/demo/node_modules/dep/index.js"
  fi
}

run() {
  local src="$1" dst="$2"
  shift 2
  (cd "$dst" && env PATH="$work/bin:$PATH" PASEO_SOURCE_CHECKOUT_PATH="$src" PASEO_WORKTREE_PATH="$dst" "$@" \
    bash "$here/worktree-deps.sh" >/dev/null)
}

# 1. Same lockfile: hardlinked node_modules, no npm.
make_checkout "$work/s1" yes
make_checkout "$work/d1"
run "$work/s1" "$work/d1"
check "no npm ci when lockfiles match" '[[ ! -e "$work/d1/.npm-called" ]]'
check "root files are hardlinks" '[[ "$(stat -c %i "$work/d1/node_modules/left-pad/index.js")" == "$(stat -c %i "$work/s1/node_modules/left-pad/index.js")" ]]'
check "workspace node_modules linked" '[[ "$(stat -c %h "$work/d1/packages/app/node_modules/tiny/index.js")" == 2 ]]'
check "custom plugin node_modules linked" '[[ "$(stat -c %h "$work/d1/custom/plugins/demo/node_modules/dep/index.js")" == 2 ]]'
check "node_modules is a real directory" '[[ -d "$work/d1/node_modules" && ! -L "$work/d1/node_modules" ]]'
check "hidden lockfile is not shared" '[[ "$(stat -c %h "$work/d1/node_modules/.package-lock.json")" == 1 ]]'
check "tool caches are not copied" '[[ ! -e "$work/d1/node_modules/.vite" && -e "$work/s1/node_modules/.vite" ]]'
check "workspace link resolves to the worktree" '[[ "$(realpath "$work/d1/node_modules/@fx/app")" == "$(realpath "$work/d1/packages/app")" ]]'

# 2. Lockfile differs: npm ci.
make_checkout "$work/s2" yes
make_checkout "$work/d2"
sed -i 's/1.0.0/1.0.1/g' "$work/d2/package-lock.json"
run "$work/s2" "$work/d2"
check "npm ci when the lockfile differs" '[[ "$(cat "$work/d2/.npm-called" 2>/dev/null)" == ci ]]'

# 3. Patches differ: npm ci.
make_checkout "$work/s3" yes
make_checkout "$work/d3"
echo 'other' >"$work/d3/patches/left-pad+1.0.0.patch"
run "$work/s3" "$work/d3"
check "npm ci when patches differ" '[[ "$(cat "$work/d3/.npm-called" 2>/dev/null)" == ci ]]'

# 4. Source install out of sync with its own lockfile: npm ci.
make_checkout "$work/s4" yes
make_checkout "$work/d4"
sed -i 's/1.0.0/0.9.0/g' "$work/s4/node_modules/.package-lock.json"
run "$work/s4" "$work/d4"
check "npm ci when the source install is stale" '[[ "$(cat "$work/d4/.npm-called" 2>/dev/null)" == ci ]]'

# 5. Forced install.
make_checkout "$work/s5" yes
make_checkout "$work/d5"
run "$work/s5" "$work/d5" PASEO_WORKTREE_DEPS=install
check "PASEO_WORKTREE_DEPS=install forces npm ci" '[[ "$(cat "$work/d5/.npm-called" 2>/dev/null)" == ci && ! -e "$work/d5/node_modules" ]]'

# 6. No source checkout: npm ci.
make_checkout "$work/d6"
(cd "$work/d6" && env -u PASEO_SOURCE_CHECKOUT_PATH PATH="$work/bin:$PATH" PASEO_WORKTREE_PATH="$work/d6" \
  bash "$here/worktree-deps.sh" >/dev/null)
check "npm ci without a source checkout" '[[ "$(cat "$work/d6/.npm-called" 2>/dev/null)" == ci ]]'

if ((failures > 0)); then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
