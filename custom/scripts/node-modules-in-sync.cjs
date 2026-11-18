// CUSTOM(worktree-shared-deps): exits 0 when <dir>/node_modules matches <dir>/package-lock.json.
// npm writes node_modules/.package-lock.json on every install; it lists what is installed. File
// mtimes can't tell this (git touches package-lock.json on every merge), the contents can.
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).packages ?? {};
let lock;
let installed;
try {
  lock = read("package-lock.json");
  installed = read("node_modules/.package-lock.json");
} catch (error) {
  console.error(`[worktree-deps] cannot read lockfiles in ${dir}: ${error.message}`);
  process.exit(1);
}

const mismatches = [];
for (const [key, entry] of Object.entries(installed)) {
  const wanted = lock[key];
  if (
    !wanted ||
    wanted.version !== entry.version ||
    wanted.resolved !== entry.resolved ||
    Boolean(wanted.link) !== Boolean(entry.link)
  ) {
    mismatches.push(key);
  }
}
for (const [key, entry] of Object.entries(lock)) {
  // Optional packages (other OS/CPU builds) are legitimately absent from the install.
  if (!key.includes("node_modules/") || entry.optional || entry.devOptional) continue;
  if (!installed[key]) mismatches.push(key);
}

if (mismatches.length > 0) {
  console.error(
    `[worktree-deps] ${dir}/node_modules differs from its package-lock.json (${mismatches.length}: ${mismatches.slice(0, 3).join(", ")})`,
  );
  process.exit(1);
}
