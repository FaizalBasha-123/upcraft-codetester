import { Effect } from "effect"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import { SessionCompaction } from "@/session/compaction"
import { applyOrchestratorReminders, TaskContext } from "@/session/orchestrator-reminders"
import { Todo } from "@/session/todo"
import { Worktree } from "@/worktree"

interface TaskRecord {
  id: string
  description: string
  agentID: string
  status: "pending" | "active" | "completed" | "failed"
  retries: number
  timestamp: number
}

interface OrchestratorMetadata {
  tasks: TaskRecord[]
  activeChildID?: string
}

// Simple task decomposition heuristic
function decomposeTasks(query: string): string[] {
  const sentences = query
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)

  if (sentences.length <= 1) return [query]

  // Check for distinct action verbs suggesting multiple tasks
  const actionVerbs = [
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

  const tasks: string[] = []
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    const hasActionVerb = actionVerbs.some((verb) => lower.startsWith(verb) || lower.includes(` ${verb} `))
    if (hasActionVerb) {
      tasks.push(sentence)
    }
  }

  return tasks.length > 0 ? tasks : [query]
}

// Calculate keyword overlap between two descriptions
function keywordOverlap(a: string, b: string): number {
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "out", "off", "over", "under", "again", "further", "then", "once", "and", "but", "or", "nor", "not", "so", "yet", "both", "either", "neither", "each", "every", "all", "any", "few", "more", "most", "other", "some", "such", "no", "only", "own", "same", "than", "too", "very", "just", "that", "this", "these", "those"])

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

// Check if a task matches an existing agent's description
function matchByDescription(task: string, agentDescription: string): boolean {
  return keywordOverlap(task, agentDescription) >= 2
}

// Check if a task matches an agent's todo context
function matchByTodoContext(
  task: string,
  todos: Array<{ content: string; context?: { criterion: number; verification: string; files: string[] } }>,
): boolean {
  const taskLower = task.toLowerCase()
  for (const todo of todos) {
    if (todo.context) {
      // Check if any file in the todo context is mentioned in the task
      const fileMatch = todo.context.files.some((f) => taskLower.includes(f.toLowerCase()))
      if (fileMatch) return true

      // Check if the verification text overlaps significantly
      if (keywordOverlap(task, todo.context.verification) >= 2) return true
    }
    // Also check todo content
    if (keywordOverlap(task, todo.content) >= 2) return true
  }
  return false
}

export const loop = Effect.fn("Orchestrator.loop")(function* (
  sessionID: SessionID,
  runAgentLoop: (id: SessionID, worktreeDir?: string) => Effect.Effect<SessionV1.WithParts>,
) {
  const sessions = yield* Session.Service
  const compaction = yield* SessionCompaction.Service
  const worktreeService = yield* Worktree.Service
  const todoService = yield* Todo.Service

  // 1. Get orchestrator session and extract task description
  const orchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
  const allMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
  const lastUserMsg = allMsgs.findLast((m) => m.info.role === "user")
  const taskDescription =
    lastUserMsg?.parts
      .filter((p): p is SessionV1.TextPart => p.type === "text")
      .map((p) => p.text)
      .join(" ") || ""

  // 2. Decompose into individual tasks
  const tasks = decomposeTasks(taskDescription)
  const metadata = (orchestratorSession.metadata as OrchestratorMetadata) || { tasks: [] }

  // 3. Process each task
  const results: SessionV1.WithParts[] = []

  for (const task of tasks) {
    // Find matching agent or spawn new one
    const { activeChild, worktreeDir } = yield* findOrCreateAgent(task, metadata, sessions, worktreeService, todoService, sessionID)

    // Build task-specific context
    const taskContext: TaskContext = {
      description: task,
      scope: extractScope(task),
      expectedOutcome: extractExpectedOutcome(task),
    }

    // Inject orchestrator reminders with task context
    yield* applyOrchestratorReminders(sessionID, activeChild.id, taskContext)

    // Delegate to agent loop
    const result = yield* runAgentLoop(activeChild.id, worktreeDir)
    results.push(result)

    // Update task history in metadata
    yield* updateTaskHistory(sessionID, task, activeChild.id, metadata, sessions)
  }

  // 4. Orchestrator compaction
  yield* compactIfNeeded(sessionID, allMsgs, sessions, compaction)

  if (results.length === 0) throw new Error("Orchestrator loop exited without a result from any child agent.")
  return results[results.length - 1]
})

function findOrCreateAgent(
  task: string,
  metadata: OrchestratorMetadata,
  sessions: Session.Service,
  worktreeService: Worktree.Service,
  todoService: Todo.Service,
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
          // Found matching agent - send task to existing agent
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

    // Store reference to child immediately to prevent TOCTOU duplicates
    yield* sessions
      .setMetadata({
        sessionID: orchestratorSessionID,
        metadata: { ...metadata, activeChildID: newChild.id },
      })
      .pipe(Effect.orDie)

    // On spawn: create worktree
    const wtInfo = yield* worktreeService.create({ name: `agent-${newChild.id}` })

    return { activeChild: newChild, worktreeDir: wtInfo.directory }
  })
}

function sendTaskToAgent(agentID: SessionID, task: string, sessions: Session.Service) {
  return Effect.gen(function* () {
    // Create a user message for the task
    const userMsg: SessionV1.User = {
      id: MessageID.ascending(),
      sessionID: agentID,
      time: { created: Date.now() },
      role: "user",
      agent: "dynamic_persona",
    }
    yield* sessions.updateMessage(userMsg)

    // Add the task text as a part
    yield* sessions.updatePart({
      type: "text",
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: agentID,
      text: task,
    })
  })
}

function updateTaskHistory(
  sessionID: SessionID,
  task: string,
  agentID: SessionID,
  metadata: OrchestratorMetadata,
  sessions: Session.Service,
) {
  return Effect.gen(function* () {
    const tasks = metadata.tasks || []
    const finalChildSession = yield* sessions.get(agentID).pipe(Effect.orDie)
    const childFailures = (finalChildSession.metadata?.failures as any[]) || []
    const finalStatus = childFailures.length > 0 ? `completed after ${childFailures.length} retries` : "completed"

    // Prevent duplicating the exact same task if the orchestrator re-runs
    if (!tasks.some((t) => t.description === task)) {
      tasks.push({
        id: `task-${Date.now()}`,
        description: task,
        agentID: agentID,
        status: "completed",
        retries: childFailures.length,
        timestamp: Date.now(),
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
  // Simple heuristic: look for file paths or module names
  const filePattern = /(?:src|lib|packages|modules?)\/[\w/]+\.\w+/g
  const matches = task.match(filePattern)
  return matches?.join(", ")
}

function extractExpectedOutcome(task: string): string | undefined {
  // Look for phrases like "so that", "in order to", "to enable"
  const patterns = [/(?:so that|in order to|to enable|to allow|to make sure that)\s+(.+?)(?:\.|$)/i]
  for (const pattern of patterns) {
    const match = task.match(pattern)
    if (match) return match[1].trim()
  }
  return undefined
}

function compactIfNeeded(
  sessionID: SessionID,
  allMessages: SessionV1.WithParts[],
  sessions: Session.Service,
  compaction: SessionCompaction.Service,
) {
  return Effect.gen(function* () {
    const userMessagesCount = allMessages.filter(
      (m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"),
    ).length

    // Compact more aggressively (every 4 delegation cycles)
    if (userMessagesCount >= 4) {
      const parent = allMessages.findLast((m) => m.info.role === "user")
      if (parent) {
        const compactionMsgID = yield* compaction.create({
          sessionID,
          agent: "compaction",
          model: (parent.info as any).model,
          auto: true,
          overflow: false,
        })
        const updatedMessages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
        yield* compaction
          .process({
            parentID: compactionMsgID,
            messages: updatedMessages,
            sessionID,
            auto: true,
            overflow: false,
            prompt: `Summarize the completed delegation cycles in this format:\n- Task: [description] -> Agent: [agentID] -> Status: [completed/failed/retried]\nPreserve the most recent 2 delegation cycles intact.\nDo not include code, file contents, or validator output in the summary.`,
          })
          .pipe(Effect.ignore)
      }
    }
  })
}
