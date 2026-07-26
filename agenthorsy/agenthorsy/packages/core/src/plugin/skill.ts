/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeAgenthorsyContent from "./skill/customize-agenthorsy.md" with { type: "text" }

export const CustomizeAgenthorsyContent = customizeAgenthorsyContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-agenthorsy",
            description:
              "Use ONLY when the user is editing or creating agenthorsy's own configuration: agenthorsy.json, agenthorsy.jsonc, files under .agenthorsy/, or files under ~/.config/agenthorsy/. Also use when creating or fixing agenthorsy agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring agenthorsy itself.",
            location: AbsolutePath.make("/builtin/customize-agenthorsy.md"),
            content: CustomizeAgenthorsyContent,
          }),
        }),
      )
    })
  }),
})
