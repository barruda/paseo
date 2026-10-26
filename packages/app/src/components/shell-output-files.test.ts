// CUSTOM(shell-output-files)
import { describe, expect, it } from "vitest";
import { shellOutputFiles } from "./shell-output-files";

describe("shellOutputFiles", () => {
  it("finds the file an agent polls for and reads back, through its variables", () => {
    const command =
      "cd /mnt/wt1; R=$(pwd -P); S=/tmp/claude-1000/wt1/scratchpad; ls $S/refs-A.txt 2>/dev/null; " +
      "unity command eval_file --project-path $R --file $S/q.cs; " +
      "for i in $(seq 1 100); do [ -f $S/refs-A.txt ] && break; sleep 5; done; " +
      "cat $S/refs-A.txt | head -150";
    expect(shellOutputFiles(command)).toEqual(["/tmp/claude-1000/wt1/scratchpad/refs-A.txt"]);
  });

  it("finds redirect and tee targets, relative ones against the cwd", () => {
    expect(
      shellOutputFiles(
        "npm test > out/test.log 2>&1; make 2>> build.err | tee -a all.log",
        "/repo",
      ),
    ).toEqual(["/repo/out/test.log", "/repo/build.err", "/repo/all.log"]);
    expect(shellOutputFiles('run &> "/tmp/my log.txt"')).toEqual(["/tmp/my log.txt"]);
  });

  it("follows cd for relative paths and skips flags of readers", () => {
    expect(shellOutputFiles("cd /a && cd b && tail -n 50 -f ../c.log", "/x")).toEqual(["/a/c.log"]);
  });

  it("leaves out what only the running shell knows", () => {
    expect(
      shellOutputFiles("out=$(mktemp); cmd > $out; cat $UNKNOWN/x; cat ~/a; cat *.log; cat -"),
    ).toEqual([]);
    expect(shellOutputFiles("echo hi > rel.txt")).toEqual([]);
  });

  it("ignores heredoc bodies and descriptor duplication", () => {
    const command =
      "python3 - <<'EOF' > /tmp/out.txt\nprint(1 > 2)\nx = a >> b\nEOF\ncat /tmp/out.txt";
    expect(shellOutputFiles(command)).toEqual(["/tmp/out.txt"]);
    expect(shellOutputFiles("cmd >&2; cmd 1>&2 < /tmp/in")).toEqual([]);
  });
});
