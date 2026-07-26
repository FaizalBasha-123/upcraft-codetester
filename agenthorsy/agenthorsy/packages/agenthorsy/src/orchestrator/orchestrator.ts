import { Effect } from "effect"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import { SessionCompaction } from "@/session/compaction"
import { applyOrchestratorReminders, type TaskContext } from "@/session/orchestrator-reminders"
import { Todo } from "@/session/todo"
import { Worktree } from "@/worktree"
import { Glob } from "@agenthorsy-ai/core/util/glob"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "@/session/message-v2"
import { Token } from "@/util/token"
import { Config } from "@/config/config"
import { usable } from "@/session/overflow"
import { ConfigV1 } from "@agenthorsy-ai/core/v1/config/config"
import { CheckpointService } from "@/checkpoint/service"
import { shouldSnapshot } from "@/checkpoint/delta"
import type { AgenthorsyChannelValues } from "@/checkpoint/serializer"

type WorktreeMethods = Pick<Worktree.Interface, "list" | "create">
type TodoMethods = Pick<Todo.Interface, "get">

interface TaskRecord {
  id: string
  description: string
  agentID: string
  status: "pending" | "active" | "completed" | "failed"
  retries: number
  timestamp: number
  completionSummary?: string
  filesModified?: string[]
}

interface OrchestratorMetadata {
  tasks: TaskRecord[]
  activeChildID?: string
  lastAggregatedSummary?: string
}

type TaskMarkerStatus = "running" | "completed" | "error"

const ORCHESTRATOR_COMPACTION_PROMPT = `You are an orchestrator compaction assistant. Summarize the following delegation history into a concise anchor.

## Objective
State the high-level goal being worked on.

## Delegation Summary
List each completed delegation cycle concisely:
- Task: [description] → Agent: [agentID] → Status: [completed/failed/retried]
- Include only the most recent 3-4 cycles.

## Work State
Summarize what has been completed, what is currently in progress, and what remains.

## Next Move
State the immediate next step the orchestrator should take.

## Relevant Files
List key files and directories relevant to ongoing work.
Do not include code, file contents, or full tool output. Keep the summary under 800 tokens.`

const DB_STRONG_PATTERNS = ["**/*.sql.ts", "**/drizzle.config.*"]
const DB_MEDIUM_PATTERNS = ["**/migrations/**/*.sql"]
const DB_WEAK_PATTERNS = [
  "**/prisma/**",
  "**/schema.prisma",
  "**/*.entity.ts",
  "**/*.model.ts",
  "**/*.schema.ts",
  "**/schema.sql",
]
const DB_PACKAGE_KEYWORDS = ["drizzle-orm", "drizzle-kit", "prisma", "@prisma/client", "typeorm", "knex", "sequelize", "mongoose"]

async function detectDatabaseCode(rootDir: string): Promise<boolean> {
  let score = 0

  for (const pattern of DB_STRONG_PATTERNS) {
    const matches = await Glob.scan(pattern, { cwd: rootDir, include: "file" })
    if (matches.length > 0) score += 3
  }

  if (score >= 2) return true

  for (const pattern of DB_MEDIUM_PATTERNS) {
    const matches = await Glob.scan(pattern, { cwd: rootDir, include: "file" })
    if (matches.length > 0) score += 2
  }

  if (score >= 2) return true

  for (const pattern of DB_WEAK_PATTERNS) {
    const matches = await Glob.scan(pattern, { cwd: rootDir, include: "file" })
    if (matches.length > 0) score += 1
  }

  try {
    const fs = await import("node:fs/promises")
    const pkgRaw = await fs.readFile(`${rootDir}/package.json`, "utf-8")
    const pkg = JSON.parse(pkgRaw)
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    const hasDBDep = DB_PACKAGE_KEYWORDS.some((kw) => kw in allDeps)
    if (hasDBDep) score += 2
  } catch {}

  return score >= 2
}

async function scaffoldDatabaseMetadata(rootDir: string): Promise<void> {
  const fs = await import("node:fs/promises")
  const target = `${rootDir}/database_metadata/schema.md`
  try {
    await fs.access(target)
    return
  } catch {}

  const sqlTsFiles = await Glob.scan("**/*.sql.ts", { cwd: rootDir, include: "file" })
  const fileList = sqlTsFiles.length > 0
    ? sqlTsFiles.map((f) => `- \`${f}\``).join("\n")
    : "_No schema files detected yet._"

  const scaffold = `# Database Schema

> Auto-generated scaffold. Agent will populate after first DB-related task.

## Tables

${fileList}
`
  await fs.mkdir(`${rootDir}/database_metadata`, { recursive: true })
  await fs.writeFile(target, scaffold, "utf-8")
}

const COMPLEX_KEYWORDS = [
  "refactor",
  "migrate",
  "redesign",
  "restructure",
  "reorganize",
  "overhaul",
  "rewrite",
  "transform",
  "modernize",
  "architect",
  "rethink",
]

const ACTION_VERBS = [
  "add",
  "create",
  "implement",
  "fix",
  "refactor",
  "update",
  "change",
  "modify",
  "build",
  "write",
  "delete",
  "remove",
  "migrate",
  "deploy",
]

function isComplexQuery(query: string): boolean {
  const wordCount = query.split(/\s+/).length
  if (wordCount > 50) return true

  const lower = query.toLowerCase()
  const verbCount = ACTION_VERBS.filter((verb) => lower.includes(verb)).length
  if (verbCount > 1) return true

  if (COMPLEX_KEYWORDS.some((kw) => lower.includes(kw))) return true

  return false
}

function exploreAndBuildContext(
  sessionID: SessionID,
  taskDescription: string,
  worktreeService: WorktreeMethods,
  sessions: Session.Interface,
  hasDB: boolean,
) {
  return Effect.gen(function* () {
    const wtList = yield* worktreeService.list()
    const rootDir = wtList[0]?.directory
    if (!rootDir) return

    const architectureDocs = [
      "architecture/overview.md",
      "architecture/modules.md",
      ...(hasDB ? ["database_metadata/schema.md"] : []),
    ]

    const readResults = yield* Effect.tryPromise(() =>
      import("node:fs/promises").then((fs) =>
        Promise.all(
          architectureDocs.map(async (doc) => {
            try {
              const content = await fs.readFile(`${rootDir}/${doc}`, "utf-8")
              return { path: doc, content }
            } catch {
              return null
            }
          }),
        ).then((results) => results.filter((r): r is { path: string; content: string } => r !== null)),
      ),
    ).pipe(Effect.catch(() => Effect.succeed([] as Array<{ path: string; content: string }>)))

    for (const doc of readResults) {
      yield* sessions.updatePart({
        type: "text",
        id: PartID.ascending(),
        messageID: MessageID.ascending(),
        sessionID,
        text: `Architecture context: ${doc.path}\n\`\`\`\n${doc.content.slice(0, 2000)}\n\`\`\``,
      })
    }

    yield* sessions.updatePart({
      type: "text",
      id: PartID.ascending(),
      messageID: MessageID.ascending(),
      sessionID,
      text: `<orchestrator-context>\nThis is a complex query requiring multiple tasks. Architecture context has been gathered from existing documentation.\nQuery: ${taskDescription}\nExisting architecture docs: ${architectureDocs.join(", ")}\n</orchestrator-context>`,
    })
  })
}

function updateContextFiles(
  sessionID: SessionID,
  task: string,
  result: SessionV1.WithParts,
  worktreeService: WorktreeMethods,
) {
  return Effect.gen(function* () {
    const wtList = yield* worktreeService.list()
    const rootDir = wtList[0]?.directory
    if (!rootDir) return

    const resultText = result.parts
      .filter((p): p is SessionV1.TextPart => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .slice(0, 500)

    yield* Effect.tryPromise(() =>
      import("node:fs/promises").then(async (fs) => {
        const dir = `${rootDir}/architecture`
        await fs.mkdir(dir, { recursive: true })
        const summaryPath = `${dir}/task-log.md`
        const entry = `\n## ${new Date().toISOString()}\n- Task: ${task}\n- Summary: ${resultText}\n`
        await fs.appendFile(summaryPath, entry, "utf-8")
      }),
    ).pipe(Effect.catch(() => Effect.void))
  })
}

// Simple task decomposition heuristic
function decomposeTasks(query: string): string[] {
  const sentences = query
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)

  if (sentences.length <= 1) return [query]

  const tasks: string[] = []
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    const hasActionVerb = ACTION_VERBS.some((verb) => lower.startsWith(verb) || lower.includes(` ${verb} `))
    if (hasActionVerb) {
      tasks.push(sentence)
    }
  }

  return tasks.length > 0 ? tasks : [query]
}

function keywordOverlap(a: string, b: string): number {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can",
    "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below", "between", "out",
    "off", "over", "under", "again", "further", "then", "once", "and", "but", "or", "nor", "not",
    "so", "yet", "both", "either", "neither", "each", "every", "all", "any", "few", "more", "most",
    "other", "some", "such", "no", "only", "own", "same", "than", "too", "very", "just", "that",
    "this", "these", "those",
  ])

  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w)),
  )
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w)),
  )

  let overlap = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++
  }
  return overlap
}

function matchByDescription(task: string, agentDescription: string): boolean {
  return keywordOverlap(task, agentDescription) >= 2
}

function matchByTodoContext(
  task: string,
  todos: Array<{ content: string; context?: { criterion: number; verification: string; files: readonly string[] } }>,
): boolean {
  const taskLower = task.toLowerCase()
  for (const todo of todos) {
    if (todo.context) {
      const fileMatch = todo.context.files.some((f) => taskLower.includes(f.toLowerCase()))
      if (fileMatch) return true
      if (keywordOverlap(task, todo.context.verification) >= 2) return true
    }
    if (keywordOverlap(task, todo.content) >= 2) return true
  }
  return false
}

function extractText(result: SessionV1.WithParts): string {
  return result.parts
    .filter((p): p is SessionV1.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export const loop = Effect.fn("Orchestrator.loop")(function* (
  sessionID: SessionID,
  runAgentLoop: (id: SessionID, worktreeDir?: string) => Effect.Effect<SessionV1.WithParts, never, any>,
) {
  const sessions = yield* Session.Service
  const compaction = yield* SessionCompaction.Service
  const worktreeService = yield* Worktree.Service
  const todoService = yield* Todo.Service
  const config = yield* Config.Service
  const provider = yield* Provider.Service
  const checkpoint = yield* CheckpointService.Service

  // Resume from checkpoint if available
  const savedState = yield* checkpoint.load(sessionID, "orchestrator").pipe(
    Effect.catch(() => Effect.succeed(null)),
  )
  const startTaskIndex = savedState?.currentTaskIndex ?? 0

  const orchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
  const allMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
  const lastUserMsg = allMsgs.findLast((m) => m.info.role === "user")
  const taskDescription =
    lastUserMsg?.parts
      .filter((p): p is SessionV1.TextPart => p.type === "text")
      .map((p) => p.text)
      .join(" ") || ""

  // Detect database code in the codebase
  const wtList = yield* worktreeService.list()
  const rootDir = wtList[0]?.directory
  const hasDB = rootDir ? yield* Effect.tryPromise(() => detectDatabaseCode(rootDir)).pipe(Effect.catch(() => Effect.succeed(false))) : false
  if (hasDB && rootDir) {
    yield* Effect.tryPromise(() => scaffoldDatabaseMetadata(rootDir)).pipe(Effect.catch(() => Effect.void))
  }

  // Auto-explore for complex queries before decomposition
  if (isComplexQuery(taskDescription)) {
    yield* exploreAndBuildContext(sessionID, taskDescription, worktreeService, sessions, hasDB)
  }

  const tasks = decomposeTasks(taskDescription)
  const metadata = (orchestratorSession.metadata as OrchestratorMetadata) || { tasks: [] }

  const results: SessionV1.WithParts[] = savedState?.results
    ? (savedState.results as any[])
    : []

  for (let i = startTaskIndex; i < tasks.length; i++) {
    const task = tasks[i]

    // Save checkpoint before starting task
    yield* checkpoint
      .save(sessionID, "orchestrator", {
        messages: allMsgs,
        todos: [],
        tokenUsage: { input: 0, output: 0, reasoning: 0 },
        step: i,
        pendingToolCalls: [],
        completedToolCalls: [],
        orchestratorMetadata: metadata as unknown as Record<string, unknown>,
        currentTaskIndex: i,
        results: results as any,
      })
      .pipe(Effect.catch(() => Effect.void))

    // Pre-task overflow check — compact before starting task if orchestrator session is near overflow
    {
      const freshMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const freshSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const model = yield* resolveModelFromSession(freshSession.model, cfg.model, provider)
      if (model) {
        const tokens = yield* estimateContextUsage(freshMsgs, model, compaction)
        if (isOrchestratorOverflow(tokens, cfg, model)) {
          yield* compactOrchestratorSession(sessionID, sessions, compaction, config, provider, `pre-task overflow (${tokens} tokens)`)
        }
      }
    }

    yield* injectTaskMarker(sessionID, task, undefined, i + 1, tasks.length, "running", sessions)

    const { activeChild, worktreeDir } = yield* findOrCreateAgent(task, metadata, sessions, worktreeService, todoService, sessionID)

    // Update marker with actual child session ID
    yield* injectTaskMarker(sessionID, task, activeChild.id, i + 1, tasks.length, "running", sessions)

    // Look up previous task completion for this agent
    const prevTask = metadata.tasks.findLast(
      (t) => t.agentID === activeChild.id && t.status === "completed" && t.completionSummary,
    )

    const taskContext: TaskContext = {
      description: task,
      scope: extractScope(task),
      expectedOutcome: extractExpectedOutcome(task),
      previousTaskCompletion: prevTask
        ? {
            description: prevTask.description,
            summary: prevTask.completionSummary ?? "",
            filesModified: prevTask.filesModified ?? [],
          }
        : undefined,
    }

    yield* applyOrchestratorReminders(sessionID, activeChild.id, taskContext, hasDB)

    const result = yield* runAgentLoop(activeChild.id, worktreeDir).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (SessionV1.ContextOverflowError.isInstance(error)) {
            yield* compactOrchestratorSession(sessionID, sessions, compaction, config, provider, "ContextOverflowError recovery")
            return yield* runAgentLoop(activeChild.id, worktreeDir)
          }
          return yield* Effect.fail(error)
        }),
      ),
    )
    results.push(result)

    // Save checkpoint after task completes
    yield* checkpoint
      .save(sessionID, "orchestrator", {
        messages: yield* sessions.messages({ sessionID }).pipe(Effect.orDie),
        todos: [],
        tokenUsage: { input: 0, output: 0, reasoning: 0 },
        step: i + 1,
        pendingToolCalls: [],
        completedToolCalls: [],
        orchestratorMetadata: metadata as unknown as Record<string, unknown>,
        currentTaskIndex: i + 1,
        results: results as any,
      })
      .pipe(Effect.catch(() => Effect.void))

    // Extract completion data from agent's final response
    const completionSummary = extractText(result).slice(0, 2000)
    const filesModified = extractScope(task)?.split(", ") ?? []

    yield* updateTaskHistory(sessionID, task, activeChild.id, metadata, sessions, completionSummary, filesModified)

    // Update architecture context files if applicable
    yield* updateContextFiles(sessionID, task, result, worktreeService)

    // Inject completion marker
    yield* injectTaskMarker(sessionID, task, activeChild.id, i + 1, tasks.length, "completed", sessions, completionSummary.slice(0, 200))

    // Mid-loop context check — compact if context overflow detected (skip last task, handled by end-of-loop)
    if (i < tasks.length - 1) {
      const orchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const model = yield* resolveModelFromSession(orchestratorSession.model, cfg.model, provider)
      if (model) {
        const freshMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
        const tokens = yield* estimateContextUsage(freshMsgs, model, compaction)
        if (isOrchestratorOverflow(tokens, cfg, model)) {
          yield* compactOrchestratorSession(sessionID, sessions, compaction, config, provider, `mid-loop overflow (${tokens} tokens)`)
        }
      }
    }
  }

  // Result aggregation — store all results in orchestrator metadata
  const aggregatedSummary = results
    .map((r, i) => {
      const text = extractText(r).slice(0, 500)
      return `Task ${i + 1} (${tasks[i]}): ${text}`
    })
    .join("\n\n")

  yield* sessions
    .setMetadata({
      sessionID,
      metadata: { ...metadata, lastAggregatedSummary: aggregatedSummary },
    })
    .pipe(Effect.orDie)

  yield* injectCompletionSummary(sessionID, metadata.tasks, tasks.length, sessions)

  yield* compactIfNeeded(sessionID, sessions, compaction, config, provider)

  if (results.length === 0) throw new Error("Orchestrator loop exited without a result from any child agent.")
  return results[results.length - 1]
})

function findOrCreateAgent(
  task: string,
  metadata: OrchestratorMetadata,
  sessions: Session.Interface,
  worktreeService: WorktreeMethods,
  todoService: TodoMethods,
  orchestratorSessionID: SessionID,
) {
  return Effect.gen(function* () {
    const existingTasks = metadata.tasks || []

    // 1. Try to find matching agent by description
    for (const t of existingTasks) {
      if (matchByDescription(task, t.description)) {
        const child = yield* sessions.get(t.agentID as SessionID).pipe(
          Effect.match({
            onFailure: () => undefined as Session.Info | undefined,
            onSuccess: (c) => c as Session.Info | undefined,
          }),
        )
        if (child && t.status !== "failed") {
          yield* sendTaskToAgent(child.id, task, sessions)
          const wtList = yield* worktreeService.list()
          const wt = wtList.find((w) => w.name === `agent-${child.id}`)
          return { activeChild: child, worktreeDir: wt?.directory }
        }
      }
    }

    // 2. Try to find matching agent by todo context
    for (const t of existingTasks) {
      if (t.status === "active" || t.status === "completed") {
        const todos = yield* todoService.get(t.agentID as SessionID)
        if (matchByTodoContext(task, todos)) {
          const child = yield* sessions.get(t.agentID as SessionID).pipe(
            Effect.match({
              onFailure: () => undefined as Session.Info | undefined,
              onSuccess: (c) => c as Session.Info | undefined,
            }),
          )
          if (child) {
            yield* sendTaskToAgent(child.id, task, sessions)
            const wtList = yield* worktreeService.list()
            const wt = wtList.find((w) => w.name === `agent-${child.id}`)
            return { activeChild: child, worktreeDir: wt?.directory }
          }
        }
      }
    }

    // 3. Fallback to active child if no match found
    if (metadata.activeChildID) {
      const child = yield* sessions.get(metadata.activeChildID as SessionID).pipe(
        Effect.match({
          onFailure: () => undefined as Session.Info | undefined,
          onSuccess: (c) => c as Session.Info | undefined,
        }),
      )
      if (child) {
        yield* sendTaskToAgent(child.id, task, sessions)
        const wtList = yield* worktreeService.list()
        const wt = wtList.find((w) => w.name === `agent-${child.id}`)
        return { activeChild: child, worktreeDir: wt?.directory }
      }
    }

    // 4. No match - spawn new dynamic_persona agent
    const newChild = yield* sessions
      .create({
        parentID: orchestratorSessionID,
        title: `Dynamic Persona - ${task.slice(0, 50)}`,
        agent: "dynamic_persona",
      })
      .pipe(Effect.orDie)

    yield* sessions
      .setMetadata({
        sessionID: orchestratorSessionID,
        metadata: { ...metadata, activeChildID: newChild.id },
      })
      .pipe(Effect.orDie)

    const wtInfo = yield* worktreeService.create({ name: `agent-${newChild.id}` })

    return { activeChild: newChild, worktreeDir: wtInfo.directory }
  })
}

function sendTaskToAgent(agentID: SessionID, task: string, sessions: Session.Interface) {
  return Effect.gen(function* () {
    const userMsg: SessionV1.User = {
      id: MessageID.ascending(),
      sessionID: agentID,
      time: { created: Date.now() },
      role: "user" as const,
      agent: "dynamic_persona",
      model: { providerID: "default" as any, modelID: "default" as any },
    }
    yield* sessions.updateMessage(userMsg as any)

    yield* sessions.updatePart({
      type: "text",
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: agentID,
      text: task,
    })
  })
}

function injectTaskMarker(
  sessionID: SessionID,
  task: string,
  childSessionID: SessionID | undefined,
  taskIndex: number,
  totalTasks: number,
  status: TaskMarkerStatus,
  sessions: Session.Interface,
  completionSummary?: string,
) {
  return Effect.gen(function* () {
    const markerMsgID = MessageID.ascending()

    const userMsg: SessionV1.User = {
      id: markerMsgID,
      sessionID,
      time: { created: Date.now() },
      role: "user" as const,
      agent: "orchestrator",
      model: { providerID: "default" as any, modelID: "default" as any },
    }
    yield* sessions.updateMessage(userMsg as any)

    yield* sessions.updatePart({
      type: "tool",
      id: PartID.ascending(),
      messageID: markerMsgID,
      sessionID,
      callID: `orchestrator_task_${taskIndex}`,
      tool: "orchestrator_task",
      state: {
        status,
        input: {
          description: task,
          subagent_type: "dynamic_persona",
          taskIndex,
          totalTasks,
        },
        metadata: {
          sessionId: childSessionID,
          taskIndex,
          totalTasks,
          status,
        },
        ...(status === "completed"
          ? { output: completionSummary ?? "completed", title: task, time: { start: Date.now(), end: Date.now() } }
          : status === "error"
            ? { error: completionSummary ?? "failed", time: { start: Date.now(), end: Date.now() } }
            : { time: { start: Date.now() } }),
      } as SessionV1.ToolPart["state"],
    } satisfies SessionV1.ToolPart as any)
  })
}

function injectCompletionSummary(
  sessionID: SessionID,
  tasks: TaskRecord[],
  totalTasks: number,
  sessions: Session.Interface,
) {
  return Effect.gen(function* () {
    const summaryLines = tasks.map((t, i) => {
      const status = t.status === "completed" ? "✅" : "❌"
      const files = t.filesModified?.length ? ` (${t.filesModified.length} files)` : ""
      return `- Task ${i + 1}: ${t.description} ${status}${files}`
    })

    const summaryText = `All ${totalTasks} tasks completed.\n\n${summaryLines.join("\n")}`

    const msgID = MessageID.ascending()
    const summaryMsg: SessionV1.User = {
      id: msgID,
      sessionID,
      time: { created: Date.now() },
      role: "user" as const,
      agent: "orchestrator",
      model: { providerID: "default" as any, modelID: "default" as any },
    }
    yield* sessions.updateMessage(summaryMsg as any)

    yield* sessions.updatePart({
      type: "text",
      id: PartID.ascending(),
      messageID: msgID,
      sessionID,
      text: summaryText,
    })
  })
}

function updateTaskHistory(
  sessionID: SessionID,
  task: string,
  agentID: SessionID,
  metadata: OrchestratorMetadata,
  sessions: Session.Interface,
  completionSummary: string,
  filesModified: string[],
) {
  return Effect.gen(function* () {
    const tasks = metadata.tasks || []
    const finalChildSession = yield* sessions.get(agentID).pipe(Effect.orDie)
    const childFailures = (finalChildSession.metadata?.failures as any[]) || []

    // Prevent duplicating the exact same task if the orchestrator re-runs
    const existing = tasks.find((t) => t.description === task && t.agentID === agentID)
    if (existing) {
      existing.status = "completed"
      existing.retries = childFailures.length
      existing.completionSummary = completionSummary
      existing.filesModified = filesModified
    } else {
      tasks.push({
        id: `task-${Date.now()}`,
        description: task,
        agentID: agentID,
        status: "completed",
        retries: childFailures.length,
        timestamp: Date.now(),
        completionSummary,
        filesModified,
      })
    }

    yield* sessions
      .setMetadata({
        sessionID,
        metadata: { ...metadata, tasks },
      })
      .pipe(Effect.orDie)
  })
}

function extractScope(task: string): string | undefined {
  const filePattern = /(?:src|lib|packages|modules?)\/[\w/]+\.\w+/g
  const matches = task.match(filePattern)
  return matches?.join(", ")
}

function extractExpectedOutcome(task: string): string | undefined {
  const patterns = [/(?:so that|in order to|to enable|to allow|to make sure that)\s+(.+?)(?:\.|$)/i]
  for (const pattern of patterns) {
    const match = task.match(pattern)
    if (match) return match[1].trim()
  }
  return undefined
}

function estimateContextUsage(
  messages: SessionV1.WithParts[],
  model: Provider.Model,
  compaction: SessionCompaction.Interface,
) {
  return Effect.gen(function* () {
    return yield* compaction.estimate({ messages, model })
  })
}

function isOrchestratorOverflow(
  estimatedTokens: number,
  cfg: ConfigV1.Info,
  model: Provider.Model,
) {
  if (cfg.compaction?.auto === false) return false
  if (model.limit.context === 0) return false
  const budget = usable({ cfg, model })
  return budget > 0 && estimatedTokens >= budget
}

function resolveModelFromSession(
  sessionModel: { id: string; providerID: string } | undefined,
  cfgModel: string | undefined,
  provider: Provider.Interface,
) {
  return Effect.gen(function* () {
    if (sessionModel) {
      return yield* provider.getModel(sessionModel.providerID as any, sessionModel.id as any).pipe(Effect.match({ onSuccess: (m) => m as Provider.Model | undefined, onFailure: () => undefined }))
    }
    if (cfgModel) {
      const parsed = Provider.parseModel(cfgModel)
      return yield* provider.getModel(parsed.providerID, parsed.modelID).pipe(Effect.match({ onSuccess: (m) => m as Provider.Model | undefined, onFailure: () => undefined }))
    }
    const defaultModel = yield* provider.defaultModel().pipe(Effect.match({ onSuccess: (m) => m, onFailure: () => undefined }))
    if (defaultModel) {
      return yield* provider.getModel(defaultModel.providerID, defaultModel.modelID).pipe(Effect.match({ onSuccess: (m) => m as Provider.Model | undefined, onFailure: () => undefined }))
    }
    return undefined
  })
}

function compactOrchestratorSession(
  sessionID: SessionID,
  sessions: Session.Interface,
  compaction: SessionCompaction.Interface,
  config: Config.Interface,
  provider: Provider.Interface,
  reason: string,
) {
  return Effect.gen(function* () {
    const freshMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
    const orchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
    const cfg = yield* config.get()
    const model = yield* resolveModelFromSession(orchestratorSession.model, cfg.model, provider)
    if (!model) return

    const compactionMsgID = yield* compaction.create({
      sessionID,
      agent: "compaction",
      model: { providerID: model.providerID as any, modelID: model.id as any },
      auto: true,
      overflow: false,
    })

    yield* compaction
      .process({
        parentID: compactionMsgID,
        messages: freshMsgs,
        sessionID,
        auto: true,
        overflow: false,
        prompt: ORCHESTRATOR_COMPACTION_PROMPT,
      })
      .pipe(Effect.ignore)
  })
}

function compactIfNeeded(
  sessionID: SessionID,
  sessions: Session.Interface,
  compaction: SessionCompaction.Interface,
  config: Config.Interface,
  provider: Provider.Interface,
) {
  return Effect.gen(function* () {
    const freshMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
    const userMessagesCount = freshMsgs.filter(
      (m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"),
    ).length

    if (userMessagesCount < 2) return

    const orchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
    const cfg = yield* config.get()
    const model = yield* resolveModelFromSession(orchestratorSession.model, cfg.model, provider)
    if (!model) return

    const usage = yield* estimateContextUsage(freshMsgs, model, compaction)
    if (!isOrchestratorOverflow(usage, cfg, model)) return

    yield* compactOrchestratorSession(sessionID, sessions, compaction, config, provider, `end-of-loop overflow (${usage} tokens)`)
  })
}
