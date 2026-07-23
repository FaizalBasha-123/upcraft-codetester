import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Service as Validator } from "../validator/validator"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"

export const Parameters = Schema.Struct({})

export const ValidateTaskTool = Tool.define(
  "validate_task",
  Effect.gen(function* () {
    const validator = yield* Validator
    const session = yield* Session.Service

    return {
      description: "Call this when you believe the work is complete. It runs deterministic AST and plan checks on your diff against the main branch.",
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const audit = yield* validator.validate(
            ctx.sessionID, 
            instance.worktree, 
            "HEAD~1", // This fallback will be resolved dynamically inside validate()
            instance.directory
          )
          
          if (!audit.success) {
            // Log failure to session metadata for failure memory
            const info = yield* session.get(ctx.sessionID).pipe(Effect.orDie)
            const failures = (info.metadata?.failures as any[]) || []
            failures.push({ attempt: failures.length + 1, reason: audit.message, discrepancies: audit.discrepancies, timestamp: Date.now() })
            yield* session.setMetadata({ sessionID: ctx.sessionID, metadata: { ...info.metadata, failures } }).pipe(Effect.orDie)
          }

          return {
            title: audit.success ? "Validation passed" : "Validation failed",
            output: audit.success ? `Validation passed: ${audit.message}\nYou MUST now call merge_worktree to finalize.` : `Validation failed: ${audit.message}\nDiscrepancies:\n${audit.discrepancies?.join("\n")}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
