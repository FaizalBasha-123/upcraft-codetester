import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({})

export const MergeWorktreeTool = Tool.define(
  "merge_worktree",
  Effect.gen(function* () {
    const git = yield* Git.Service

    return {
      description: "Call this AFTER validation passes. It safely merges your worktree back into the main codebase.",
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const worktreeBranch = yield* git.branch(instance.worktree)
          
          if (!worktreeBranch) {
            return { title: "Merge Failed", output: "Worktree is not on a valid branch.", metadata: {} }
          }
          
          const defaultBranch = yield* git.defaultBranch(instance.directory)
          const targetBranch = defaultBranch?.name || "main"
          
          // Execute merge on the parent directory
          const mergeResult = yield* git.run(["merge", worktreeBranch], { cwd: instance.directory })
          
          if (mergeResult.exitCode !== 0) {
            return {
              title: "Merge Failed",
              output: `Merge conflicts or errors occurred:\n${mergeResult.stderr.toString("utf8")}`,
              metadata: {}
            }
          }
          
          return {
            title: "Merge Succeeded",
            output: `Successfully merged ${worktreeBranch} into ${targetBranch}. Task is complete. Stop execution.`,
            metadata: {}
          }
        }).pipe(Effect.orDie),
    }
  }),
)
