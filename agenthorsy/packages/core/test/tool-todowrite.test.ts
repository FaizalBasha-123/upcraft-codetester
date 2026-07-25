import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@agenthorsy-ai/core/database/database"
import { AppNodeBuilder } from "@agenthorsy-ai/core/effect/app-node-builder"
import { LayerNode } from "@agenthorsy-ai/core/effect/layer-node"
import { EventV2 } from "@agenthorsy-ai/core/event"
import { PermissionV2 } from "@agenthorsy-ai/core/permission"
import { Project } from "@agenthorsy-ai/core/project"
import { ProjectTable } from "@agenthorsy-ai/core/project/sql"
import { AbsolutePath } from "@agenthorsy-ai/core/schema"
import { SessionV2 } from "@agenthorsy-ai/core/session"
import { SessionTable } from "@agenthorsy-ai/core/session/sql"
import { SessionTodo } from "@agenthorsy-ai/core/session/todo"
import { TodoWriteTool } from "@agenthorsy-ai/core/tool/todowrite"
import { ToolRegistry } from "@agenthorsy-ai/core/tool/registry"
import { ToolOutputStore } from "@agenthorsy-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_todowrite_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionTodo.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      TodoWriteTool.node,
    ]),
    [
      [PermissionV2.node, permission],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
  deny = false
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todowrite",
      directory: "/project",
      title: "todowrite",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (todos: ReadonlyArray<SessionTodo.Info>, id = "call-todowrite") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoWriteTool.name, input: { todos } },
})

describe("TodoWriteTool", () => {
  it.effect("registers, approves the wildcard resource, persists todos, and returns typed output", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList: ReadonlyArray<SessionTodo.Info> = [
        {
          content: "Implement slice",
          status: "in_progress",
          priority: "high",
          context: { criterion: 1, verification: "gating: tests pass", files: ["src/slice.ts"] },
        },
      ]

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([TodoWriteTool.name])
      expect(yield* settleTool(registry, call(todoList))).toEqual({
        result: { type: "text", value: JSON.stringify(todoList, null, 2) },
        output: {
          structured: { todos: todoList },
          content: [{ type: "text", text: JSON.stringify(todoList, null, 2) }],
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
      expect(yield* service.get(sessionID)).toEqual(todoList)
    }),
  )

  it.effect("rejects todos without context", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList: ReadonlyArray<SessionTodo.Info> = [
        { content: "Missing context", status: "in_progress", priority: "high" },
      ]

      expect(yield* executeTool(registry, call(todoList))).toEqual({
        type: "error",
        value: "1 todo(s) missing required context field (criterion, verification, files). Every todo must include context.",
      })
      expect(yield* service.get(sessionID)).toEqual([])
    }),
  )

  it.effect("accepts todos with context", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList: ReadonlyArray<SessionTodo.Info> = [
        {
          content: "Has context",
          status: "pending",
          priority: "medium",
          context: { criterion: 2, verification: "evidence: UI renders", files: ["src/ui.tsx"] },
        },
      ]

      expect(yield* settleTool(registry, call(todoList))).toEqual({
        result: { type: "text", value: JSON.stringify(todoList, null, 2) },
        output: {
          structured: { todos: todoList },
          content: [{ type: "text", text: JSON.stringify(todoList, null, 2) }],
        },
      })
      expect(yield* service.get(sessionID)).toEqual(todoList)
    }),
  )

  it.effect("does not update persisted todos when permission is denied", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      yield* service.update({
        sessionID,
        todos: [{ content: "keep", status: "pending", priority: "low", context: { criterion: 1, verification: "ok", files: [] } }],
      })
      deny = true

      expect(
        yield* executeTool(
          registry,
          call([{ content: "blocked", status: "completed", priority: "high", context: { criterion: 1, verification: "ok", files: [] } }]),
        ),
      ).toEqual({
        type: "error",
        value: "Unable to update todos",
      })
      expect(yield* service.get(sessionID)).toEqual([
        { content: "keep", status: "pending", priority: "low", context: { criterion: 1, verification: "ok", files: [] } },
      ])
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
    }),
  )
})
