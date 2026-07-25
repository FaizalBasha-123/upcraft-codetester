import path from "path"
import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { MessageID, PartID } from "../session/schema"

export const Parameters = Schema.Struct({
  mode: Schema.Literals(["build", "plan"])
})

export const SwitchModeTool = Tool.define(
  "switch_mode",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description: "Switch your own agent mode between 'build' and 'plan'. Use 'plan' for drafting architecture, 'build' for implementing code.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: params.mode,
            model,
          }
          yield* session.updateMessage(msg).pipe(Effect.orDie)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `Agent autonomously switched mode to ${params.mode}. You can now proceed with your task in the new mode.`,
            synthetic: true,
          } satisfies SessionV1.TextPart).pipe(Effect.orDie)

          return {
            title: `Switched mode to ${params.mode}`,
            output: `Successfully switched to ${params.mode} agent. Wait for further instructions.`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
