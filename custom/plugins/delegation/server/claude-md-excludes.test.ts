import { describe, expect, it } from "vitest";
import { buildClaudeMdExcludes } from "./claude-md-excludes";

describe("buildClaudeMdExcludes", () => {
  const list = buildClaudeMdExcludes({
    projectRoot: "/home/bruno/projetos/paseo",
    configDir: "/home/bruno/.claude-personal",
  });

  it("excludes the config dir's CLAUDE.md and rules", () => {
    expect(list).toContain("/home/bruno/.claude-personal/CLAUDE.md");
    expect(list).toContain("/home/bruno/.claude-personal/rules/**");
  });

  it("excludes every ancestor above the project, up to the root", () => {
    for (const dir of ["/home/bruno/projetos", "/home/bruno", "/home"]) {
      expect(list).toContain(`${dir}/CLAUDE.md`);
      expect(list).toContain(`${dir}/CLAUDE.local.md`);
      expect(list).toContain(`${dir}/.claude/CLAUDE.md`);
      expect(list).toContain(`${dir}/.claude/rules/**`);
    }
    expect(list).toContain("/CLAUDE.md");
    expect(list).toContain("/.claude/rules/**");
  });

  it("keeps the project's own files", () => {
    expect(list.some((entry) => entry.startsWith("/home/bruno/projetos/paseo/"))).toBe(false);
  });

  it("has no duplicates when the config dir is an ancestor's .claude", () => {
    const again = buildClaudeMdExcludes({
      projectRoot: "/home/bruno/projetos/paseo",
      configDir: "/home/bruno/.claude",
    });
    expect(new Set(again).size).toBe(again.length);
    expect(again.filter((entry) => entry === "/home/bruno/.claude/CLAUDE.md")).toHaveLength(1);
  });
});
