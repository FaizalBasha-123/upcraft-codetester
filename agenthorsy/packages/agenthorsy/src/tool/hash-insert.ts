import * as path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@agenthorsy-ai/core/fs-util"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as crypto from "crypto"
import ts from "typescript"

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  targetHash: Schema.String.annotate({ description: "The SHA-256 hash of the AST node text to replace" }),
  replacement: Schema.String.annotate({ description: "The code to insert in place of the target" }),
})

export const HashInsertTool = Tool.define(
  "hash_insert",
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service

    return {
      description: "Uses AST parsing and content hashing to safely insert code blocks. Prefer this over raw edit tools to prevent syntax collisions.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)

          // H-1: Path traversal fix via external directory bounds check
          yield* assertExternalDirectoryEffect(ctx, filePath)

          const fileContent = yield* afs.readFileString(filePath)

          // AST Parsing for structural analysis
          const sourceFile = ts.createSourceFile(
            filePath,
            fileContent,
            ts.ScriptTarget.Latest,
            true
          )

          const match = { node: undefined as ts.Node | undefined }

          // Deep traversal to isolate node by semantic hash
          const traverse = (node: ts.Node) => {
            if (match.node) return
            
            // Normalize spacing for hash comparison
            const text = node.getText(sourceFile).trim()
            if (text.length > 0) {
              const hash = crypto.createHash("sha256").update(text).digest("hex")
              if (hash === params.targetHash) {
                match.node = node
              }
            }
            ts.forEachChild(node, traverse)
          }

          traverse(sourceFile)

          if (!match.node) {
            throw new Error(`Failed to find AST node matching hash: ${params.targetHash}`)
          }

          // Surgical application using AST precise offsets
          const start = match.node.getStart(sourceFile)
          const end = match.node.getEnd()
          const prefix = fileContent.substring(0, start)
          const suffix = fileContent.substring(end)
          
          const newContent = prefix + params.replacement + suffix
          
          // Commit the structural change
          yield* afs.writeFileString(filePath, newContent)

          // C-3: Fixed return type to Tool.ExecuteResult
          return {
            title: "Hash Insert",
            output: `Successfully parsed AST, found node (hash ${params.targetHash}), and replaced content at byte offset ${start}-${end} in ${params.filePath}`,
            metadata: {}
          } satisfies Tool.ExecuteResult
        }).pipe(Effect.orDie),
    }
  })
)
