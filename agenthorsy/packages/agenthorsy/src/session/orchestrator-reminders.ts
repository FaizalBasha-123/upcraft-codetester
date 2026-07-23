import { Effect } from "effect"
import { SessionID, PartID } from "@/session/schema"
import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import { Session } from "@/session/session"

export interface TaskContext {
  description: string
  scope?: string
  expectedOutcome?: string
  acceptanceCriteria?: string[]
}

export const applyOrchestratorReminders = Effect.fn("OrchestratorReminders.apply")(function* (
  orchestratorSessionID: SessionID,
  agentSessionID: SessionID,
  taskContext?: TaskContext,
) {
  const sessions = yield* Session.Service

  // 1. Fetch child's recent messages
  const childMessages = yield* sessions.messages({ sessionID: agentSessionID }).pipe(Effect.orDie)
  const lastUserMsg = [...childMessages].reverse().find((m) => m.info.role === "user")

  if (lastUserMsg) {
    // 2. Build task-specific directive
    let directive: string

    if (taskContext) {
      const parts = [`Task: ${taskContext.description}`]
      if (taskContext.scope) parts.push(`Scope: ${taskContext.scope}`)
      if (taskContext.expectedOutcome) parts.push(`Expected outcome: ${taskContext.expectedOutcome}`)
      if (taskContext.acceptanceCriteria?.length) {
        parts.push(`Acceptance criteria:\n${taskContext.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`)
      }
      directive = parts.join("\n")
    } else {
      // Fallback: extract from parent orchestrator's user message
      const parentMessages = yield* sessions.messages({ sessionID: orchestratorSessionID }).pipe(Effect.orDie)
      if (parentMessages.length === 0) return

      const parentUserMsg = parentMessages.find((m) => m.info.role === "user")
      if (!parentUserMsg) return

      directive = parentUserMsg.parts
        .filter((p): p is SessionV1.TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")
    }

    // 3. Read child's failure history from metadata
    const childInfo = yield* sessions.get(agentSessionID).pipe(Effect.orDie)
    const failures = (childInfo.metadata?.failures as any[]) || []
    const failureContext =
      failures.length > 0
        ? `\n\n<failure-history>\nYou have previously failed this task ${failures.length} times. Latest failure reason: ${failures[failures.length - 1].reason}\n</failure-history>`
        : ""

    // 4. Inject context from orchestrator to agent
    yield* sessions
      .updatePart({
        id: PartID.ascending(),
        messageID: lastUserMsg.info.id,
        sessionID: agentSessionID,
        type: "text",
        text: `\n\n<orchestrator-directive>\n${directive}\n</orchestrator-directive>${failureContext}`,
      })
      .pipe(Effect.orDie)
  }
})
