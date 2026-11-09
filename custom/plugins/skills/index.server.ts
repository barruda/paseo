import type { PluginServerContext } from "@getpaseo/plugin/server";

import { createLoadedSkillsHandler } from "./server/loaded/handler.ts";
import { createListSkillsHandler, createReadSkillHandler } from "./server/skills";
import { listSkills, loadedSkills, readSkill } from "./shared/skills";

export default function contribute(server: PluginServerContext) {
  server.handle(listSkills, createListSkillsHandler());
  server.handle(readSkill, createReadSkillHandler());
  // CUSTOM(skills-loaded): what the agent's session file says is in its context.
  server.handle(loadedSkills, createLoadedSkillsHandler());
  return () => {};
}
