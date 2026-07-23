import { Effect } from "effect"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import { SessionCompaction } from "@/session/compaction"
import { applyOrchestratorReminders } from "@/session/orchestrator-reminders"
import { Worktree } from "@/worktree"

export const loop = Effect.fn("Orchestrator.loop")(function* (
  sessionID: SessionID,
  runAgentLoop: (id: SessionID, worktreeDir?: string) => Effect.Effect<SessionV1.WithParts>
) {
  const sessions = yield* Session.Service
  const compaction = yield* SessionCompaction.Service
  const worktreeService = yield* Worktree.Service

  // 1. User query comes in -> orchestrator's context window stores task description
  // 2. Orchestrator spawns a Dynamic Persona Agent session with a fresh git worktree
  const orchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)

  // Find an active child session or spawn one
  const { activeChild, worktreeDir, taskDescription } = yield* Effect.gen(function* () {
    const allMsgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
    const lastUserMsg = allMsgs.findLast(m => m.info.role === "user")
    const taskDescription = lastUserMsg?.parts
      .filter((p): p is SessionV1.TextPart => p.type === "text")
      .map(p => p.text)
      .join(" ") || ""

    const tasks = (orchestratorSession.metadata?.tasks as any[]) || []
    let child: Session.Info | undefined = undefined

    // 1. Check if related to a previous task (basic semantic/keyword matching)
    if (tasks.length > 0) {
      const words = taskDescription.toLowerCase().split(/\s+/)
      for (const t of tasks) {
        if (t.description) {
          const tWords = t.description.toLowerCase().split(/\s+/)
          // If they share at least 2 significant words, consider it related
          const overlap = words.filter(w => w.length > 3 && tWords.includes(w))
          if (overlap.length >= 2) {
            child = yield* sessions.get(t.agentID as SessionID).pipe(
              Effect.match({
                onFailure: () => undefined as Session.Info | undefined,
                onSuccess: (c) => c as Session.Info | undefined
              })
            )
            if (child) break
          }
        }
      }
    }

    // 2. Fallback to the active child if no strong semantic match is found
    if (!child && orchestratorSession.metadata?.activeChildID) {
      child = yield* sessions.get(orchestratorSession.metadata.activeChildID as SessionID).pipe(
        Effect.match({
          onFailure: () => undefined as Session.Info | undefined,
          onSuccess: (c) => c as Session.Info | undefined
        })
      )
    }

    if (!child) {
      const newChild = yield* sessions.create({
        parentID: sessionID,
        title: `${orchestratorSession.title} (Agent)`,
        agent: "build", // Dynamic Persona Agent
      }).pipe(Effect.orDie)

      // Store reference to child immediately to prevent TOCTOU duplicates
      yield* sessions.setMetadata({
        sessionID,
        metadata: { ...(orchestratorSession.metadata ?? {}), activeChildID: newChild.id }
      }).pipe(Effect.orDie)

      // On spawn: orchestrator calls Worktree.create()
      const wtInfo = yield* worktreeService.create({ name: `agent-${newChild.id}` })
      return { activeChild: newChild, worktreeDir: wtInfo.directory, taskDescription }
    } else {
      const wtList = yield* worktreeService.list()
      const wt = wtList.find(w => w.name === `agent-${child!.id}`)
      return { activeChild: child, worktreeDir: wt?.directory, taskDescription }
    }
  })

  // Inject orchestrator reminders before delegating
  yield* applyOrchestratorReminders(sessionID, activeChild.id)

  // 3. Delegate to agent loop
  const result = yield* runAgentLoop(activeChild.id, worktreeDir)

  // 4. Update task history in metadata
  const updatedOrchestratorSession = yield* sessions.get(sessionID).pipe(Effect.orDie)
  const tasks = (updatedOrchestratorSession.metadata?.tasks as any[]) || []
  
  // Read child's failure history
  const finalChildSession = yield* sessions.get(activeChild.id).pipe(Effect.orDie)
  const childFailures = (finalChildSession.metadata?.failures as any[]) || []
  const finalStatus = childFailures.length > 0 ? `completed after ${childFailures.length} retries` : "completed"

  // Prevent duplicating the exact same task if the orchestrator re-runs
  if (!tasks.some(t => t.description === taskDescription)) {
    tasks.push({
      id: `task-${Date.now()}`,
      description: taskDescription,
      agentID: activeChild.id,
      status: finalStatus,
      retries: childFailures.length,
      timestamp: Date.now()
    })
  }

  yield* sessions.setMetadata({
    sessionID,
    metadata: { ...updatedOrchestratorSession.metadata, tasks }
  }).pipe(Effect.orDie)

  // 5. Orchestrator's compaction: Summary + Task Map
  const allMessages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
  const userMessagesCount = allMessages.filter(m => m.info.role === "user" && !m.parts.some(p => p.type === "compaction")).length
  
  // Compact more aggressively (every 4 delegation cycles)
  if (userMessagesCount >= 4) {
    const parent = allMessages.findLast(m => m.info.role === "user")
    if (parent) {
      const compactionMsgID = yield* compaction.create({
        sessionID,
        agent: "compaction",
        model: (parent.info as any).model,
        auto: true,
        overflow: false
      })
      const updatedMessages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      yield* compaction.process({
        parentID: compactionMsgID,
        messages: updatedMessages,
        sessionID,
        auto: true,
        overflow: false,
        prompt: `Summarize the completed delegation cycles in this format:\n- Task: [description] -> Agent: [agentID] -> Status: [completed/failed/retried]\nPreserve the most recent 2 delegation cycles intact.\nDo not include code, file contents, or validator output in the summary.`
      }).pipe(Effect.ignore)
    }
  }

  if (!result) throw new Error("Orchestrator loop exited without a result from the child agent.")
  return result
})
