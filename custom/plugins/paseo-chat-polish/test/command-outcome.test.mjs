import assert from "node:assert/strict";
import { test } from "node:test";
import { commandOutcome, isRealFailure, lastStatementCommands } from "../shared/command-outcome.ts";
import { changeSummary, recapData } from "../shared/recap.ts";
import { toolData, turnMarkdown } from "../client/model.ts";

// CUSTOM(command-outcome): tests for the heuristic that separates real failures from harmless nonzero exits.

const shell = (command, extra = {}) => ({ type: "tool_call", callId: "1", name: "Bash", status: "completed", error: null, detail: { type: "shell", command }, ...extra });
// A Claude Bash call whose tool_result came back with is_error: Paseo keeps the block as the error.
const claudeFailed = (command, content) => shell(command, { status: "failed", error: { type: "tool_result", tool_use_id: "t", is_error: true, content } });
const kind = (item) => commandOutcome(item)?.kind;

// The two commands from session c7675891 (2026-11-19, gnome-custom): both printed what the agent needed, then exited 1.
const VANISHED_PROC = claudeFailed(
  `for pid in $(pgrep -f "ozone-platform=wayland"); do tr '\\0' ' ' < /proc/$pid/cmdline | grep -v -- "--type=" | cut -c1-200; done | sort -u; echo ---; for pid in $(pgrep -f "enable-wayland-ime"); do tr '\\0' '\\n' < /proc/$pid/cmdline | head -1; done | sort | uniq -c; for pid in $(pgrep -f "enable-wayland-ime" | head -2); do tr '\\0' ' ' < /proc/$pid/cmdline | grep -oE "\\-\\-[a-z-]*(ime|text-input)[^ ]*"; done`,
  "Exit code 1\n---\n      2 /bin/bash\n/bin/bash: line 1: /proc/144834/cmdline: No such file or directory",
);
const EMPTY_TEST = claudeFailed(
  `grep -l "Paseo" ~/.local/share/applications/*.desktop 2>/dev/null; grep -n "^Exec" ~/.local/share/applications/paseo-personal.desktop 2>/dev/null; f=$(which paseo-personal 2>/dev/null || ls ~/.local/bin/paseo-personal 2>/dev/null); echo "$f"; [ -n "$f" ] && grep -n "ELECTRON\\|exec\\|FLAGS" "$f" | head`,
  'Exit code 1\n/home/bruno/.local/share/applications/paseo-telus.desktop\n/home/bruno/.local/share/applications/paseo-personal.desktop\n4:Exec=env PASEO_HOME=/home/bruno/.paseo "/home/bruno/Applications/Paseo" %U',
);

test("real case: a loop that read a vanished /proc entry after printing its output only exited nonzero", () => {
  assert.deepEqual(commandOutcome(VANISHED_PROC), {
    kind: "nonzero",
    exit: 1,
    output: "---\n      2 /bin/bash\n/bin/bash: line 1: /proc/144834/cmdline: No such file or directory",
  });
});

test("real case: `[ -n \"$f\" ] && grep …` with an empty $f at the end only exited nonzero", () => {
  assert.equal(kind(EMPTY_TEST), "nonzero");
  assert.equal(commandOutcome(EMPTY_TEST).exit, 1);
});

test("exit 0 and running or canceled calls are not judged", () => {
  assert.equal(kind(shell("ls")), "ok");
  assert.equal(kind(shell("ls", { detail: { type: "shell", command: "ls", exitCode: 0, output: "a" } })), "ok");
  assert.equal(commandOutcome(shell("ls", { status: "running" })), undefined);
  assert.equal(commandOutcome(shell("ls", { status: "canceled" })), undefined);
  assert.equal(commandOutcome({ type: "tool_call", callId: "1", name: "Read", status: "failed", error: null, detail: { type: "read", filePath: "a" } }), undefined);
});

test("grep, test and [ at the end of the last statement exit 1 without output and stay neutral", () => {
  assert.equal(kind(claudeFailed('grep -rn "needle" src', "Exit code 1")), "nonzero");
  assert.equal(kind(claudeFailed('cd src && rg foo | head', "Exit code 1")), "nonzero");
  assert.equal(kind(claudeFailed('x=1; [ -n "$y" ] && echo yes', "Exit code 1")), "nonzero");
  assert.equal(kind(claudeFailed("test -f missing.txt", "Exit code 1")), "nonzero");
  // grep's own error code is 2.
  assert.equal(kind(claudeFailed('grep -rn "needle" nowhere', "Exit code 2")), "failed");
});

test("exit 1 with no output from anything else is a failure", () => {
  assert.equal(kind(claudeFailed("npm run build", "Exit code 1")), "failed");
  assert.equal(kind(claudeFailed('grep foo a.txt; make', "Exit code 1")), "failed");
});

test("error output is red whatever the exit code", () => {
  assert.equal(kind(claudeFailed("foo --bar", "Exit code 1\n/bin/bash: line 1: foo: command not found")), "failed");
  assert.equal(kind(claudeFailed("cat /root/x", "Exit code 1\ncat: /root/x: Permission denied")), "failed");
  assert.equal(kind(claudeFailed("python3 x.py", 'Exit code 1\nTraceback (most recent call last):\n  File "x.py", line 1')), "failed");
  assert.equal(kind(claudeFailed("git checkout nope", "Exit code 1\nerror: pathspec 'nope' did not match any file(s) known to git")), "failed");
  assert.equal(kind(claudeFailed("git status", "Exit code 1\nfatal: not a git repository")), "failed");
  assert.equal(kind(claudeFailed("node x.js", "Exit code 1\nTypeError: x is not a function\n    at y")), "failed");
  assert.equal(kind(claudeFailed("npx tsc --noEmit", "Exit code 1\nsrc/a.ts(1,7): error TS2322: Type 'string' is not assignable")), "failed");
  assert.equal(kind(claudeFailed("npx vitest run", "Exit code 1\n FAIL  src/a.test.ts > adds")), "failed");
});

test("timeouts, kills and the harness's own errors are red", () => {
  assert.equal(kind(claudeFailed("timeout 5 sleep 10", "Exit code 124")), "failed");
  assert.equal(kind(claudeFailed("sleep 100", "Exit code 137\npartial output")), "failed");
  assert.equal(kind(claudeFailed("foo", "Exit code 127\n")), "failed");
  assert.equal(kind(claudeFailed("sleep 1000", "Command timed out after 2m 0.0s")), "failed");
  assert.equal(kind(claudeFailed("rm -rf /", "Permission to use Bash with command rm -rf / has been denied.")), "failed");
  assert.equal(kind(shell("sleep 1000", { status: "failed", error: { message: "Tool call failed" } })), "failed");
  // A provider that reports the exit code in the detail: Codex killed (null) and exited.
  assert.equal(kind(shell("x", { status: "failed", detail: { type: "shell", command: "x", exitCode: null, output: "" } })), "failed");
  assert.equal(kind(shell("grep a b", { detail: { type: "shell", command: "grep a b", exitCode: 1, output: "" } })), "nonzero");
});

test("exit codes above 1 with output count as failures", () => {
  assert.equal(kind(claudeFailed("make", "Exit code 2\nmake: *** [all] Fehler 1")), "failed");
});

test("isRealFailure: only real failures for shell calls, every failed non-shell call", () => {
  assert.equal(isRealFailure(VANISHED_PROC), false);
  assert.equal(isRealFailure(claudeFailed("npm run build", "Exit code 1")), true);
  assert.equal(isRealFailure({ type: "tool_call", callId: "1", name: "Read", status: "failed", error: null, detail: { type: "read", filePath: "a" } }), true);
  assert.equal(isRealFailure({ type: "assistant_message", text: "hi" }), false);
});

test("lastStatementCommands: the stages of the last statement, quotes and redirections ignored", () => {
  assert.deepEqual(lastStatementCommands('a; [ -n "$f" ] && grep -n "x|y; z" "$f" | head'), ["[", "grep", "head"]);
  assert.deepEqual(lastStatementCommands("FOO=1 sudo /usr/bin/grep x 2>&1"), ["grep"]);
  assert.deepEqual(lastStatementCommands("if true; then\n  test -d x\nfi"), ["test"]);
});

test("recap: real failures and nonzero exits are counted apart, each with its exit code and output tail", () => {
  const items = [shell("ls"), VANISHED_PROC, EMPTY_TEST, claudeFailed("npm run build", "Exit code 1")];
  const recap = changeSummary(items, "/w");
  assert.equal(recap.commands, 4);
  assert.deepEqual(recap.failed, [{ command: "npm run build", exit: 1 }]);
  assert.equal(recap.nonzero.length, 2);
  assert.equal(recap.nonzero[0].exit, 1);
  assert.equal(recap.nonzero[0].output, "---\n      2 /bin/bash\n/bin/bash: line 1: /proc/144834/cmdline: No such file or directory");
});

test("recap: a turn whose only news is a nonzero exit still gets a recap", () => {
  const recap = recapData([{ type: "user_message", text: "go" }, shell("ls"), VANISHED_PROC], "/w");
  assert.equal(recap.failed.length, 0);
  assert.equal(recap.nonzero.length, 1);
  assert.equal(recapData([{ type: "user_message", text: "go" }, shell("ls")], "/w"), undefined);
});

test("rows: a nonzero exit is a neutral row with exit N and its output; a real failure stays red", () => {
  const neutral = toolData(VANISHED_PROC);
  assert.equal(neutral.status, "completed");
  assert.equal(neutral.meta, "exit 1");
  assert.equal(neutral.metaTone, "muted");
  assert.match(neutral.detail.text, /No such file or directory/);
  const red = toolData(claudeFailed("npm run build", "Exit code 1"));
  assert.equal(red.status, "failed");
  assert.equal(red.metaTone, "danger");
  const codex = toolData(shell("make", { detail: { type: "shell", command: "make", exitCode: 2, output: "make: *** Error 2" } }));
  assert.equal(codex.status, "failed");
});

test("copied turn Markdown lists nonzero exits apart from failures", () => {
  const md = turnMarkdown([{ type: "user_message", text: "go" }, VANISHED_PROC, claudeFailed("npm run build", "Exit code 1")], "/w");
  assert.match(md, /1 failed · 1 exit≠0/);
  assert.match(md, /- ✗ `npm run build` \(exit 1\)/);
  assert.match(md, /- · `for pid in/);
});
