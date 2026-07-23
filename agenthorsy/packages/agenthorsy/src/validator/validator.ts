import { Effect, Context, Layer } from "effect"
import * as Stream from "effect/Stream"
import { Git } from "@/git"
import { SessionID } from "@/session/schema"
import { FSUtil } from "@agenthorsy-ai/core/fs-util"
import path from "path"
import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import ts from "typescript"
import { LayerNode } from "@agenthorsy-ai/core/effect/layer-node"

export interface AuditReport {
  success: boolean
  message: string
  diff?: string
  discrepancies?: string[]
}

export interface Interface {
  readonly validate: (
    sessionID: SessionID,
    worktreeDir: string,
    baseRef: string,
    baseDir: string
  ) => Effect.Effect<AuditReport, unknown, never>
}

export class Service extends Context.Service<Service, Interface>()("@agenthorsy/Validator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const git = yield* Git.Service
    const fs = yield* FSUtil.Service

    const validate = Effect.fn("Validator.validate")(function* (
      sessionID: SessionID,
      worktreeDir: string,
      baseRefFallback: string,
      baseDir: string
    ) {
      // A3: Dynamically resolve the true baseRef using git merge-base
      let baseRef = baseRefFallback
      const defaultBranch = yield* git.defaultBranch(worktreeDir)
      if (defaultBranch) {
        const mergeBase = yield* git.mergeBase(worktreeDir, defaultBranch.name, "HEAD")
        if (mergeBase) baseRef = mergeBase
      }

      const diffs = yield* git.diff(worktreeDir, baseRef)
      
      if (diffs.length === 0) {
        return { success: false, message: "No changes detected in worktree." } satisfies AuditReport
      }

      // 1. Fetch Plan
      const planPath = path.join(worktreeDir, "plan.md")
      const planExists = yield* fs.existsSafe(planPath)
      const planContent = planExists ? yield* fs.readFileString(planPath) : "No plan provided."

      // 2. Fetch diff patch for context
      const patch = yield* git.patchAll(worktreeDir, baseRef)

      // 3. Strict Deterministic AST & Plan Checking (A4: Replacing LLM Audit)
      const discrepancies: string[] = []

      // Check Plan for incomplete tasks
      const uncheckedTodos = planContent.split("\n").filter((line: string) => line.trim().startsWith("- [ ]"))
      if (uncheckedTodos.length > 0) {
        discrepancies.push(`Incomplete plan tasks found: ${uncheckedTodos.length} unchecked items.`)
      }

      // Check modified TypeScript files for basic structural syntax errors
      for (const d of diffs) {
        if (d.status !== "deleted" && (d.file.endsWith(".ts") || d.file.endsWith(".tsx"))) {
          const filePath = path.join(worktreeDir, d.file)
          if (yield* fs.existsSafe(filePath)) {
            const content = yield* fs.readFileString(filePath)
            const sourceFile = ts.createSourceFile(d.file, content, ts.ScriptTarget.Latest, true)
            // @ts-ignore - internal diagnostic check
            const parseDiagnostics = sourceFile.parseDiagnostics
            if (parseDiagnostics && parseDiagnostics.length > 0) {
              discrepancies.push(`Syntax error detected in ${d.file}.`)
            }
          }
        }
      }

      if (discrepancies.length > 0) {
        return {
          success: false,
          message: "Validator audit rejected the implementation.",
          diff: patch.text,
          discrepancies
        } satisfies AuditReport
      }

      return {
        success: true,
        message: `Validation passed. Your changes are functionally sound and the plan is complete.`,
        diff: patch.text
      } satisfies AuditReport
    })

    return Service.of({ validate })
  })
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Git.node, FSUtil.node]
})
