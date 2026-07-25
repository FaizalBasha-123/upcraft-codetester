import { createMemo, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useNavigate, useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { sessionHref, requireServerKey } from "@/utils/session-route"
import type { Session, Part } from "@agenthorsy-ai/sdk/v2"

interface AgentTask {
  session: Session
  status: "running" | "completed" | "failed" | "pending"
  description: string
  index: number
  total: number
}

export function AgentPanel(props: { onClose: () => void }) {
  const sync = useSync()
  const navigate = useNavigate()
  const params = useParams()
  const sdk = useSDK()

  const currentSessionID = () => params.id

  const childSessions = createMemo(() => {
    const sessions = sync().data.session ?? []
    const parentID = currentSessionID()
    if (!parentID) return []
    return sessions.filter((s) => s.parentID === parentID)
  })

  const agentTasks = createMemo(() => {
    const children = childSessions()
    return children.map((session, index) => {
      const messages = sync().data.message[session.id] ?? []
      const allParts = messages.flatMap((m) => sync().data.part[m.id] ?? [])
      const toolParts = allParts.filter((p): p is Extract<Part, { type: "tool"; tool: string }> => p.type === "tool" && p.tool === "task")

      const lastToolPart = toolParts[toolParts.length - 1]
      const status = (() => {
        if (lastToolPart?.state.status === "running") return "running"
        if (lastToolPart?.state.status === "completed") return "completed"
        if (lastToolPart?.state.status === "error") return "failed"
        return "pending"
      })()

      const description = session.title.replace(/^Dynamic Persona - /, "")

      return {
        session,
        status,
        description,
        index: index + 1,
        total: children.length,
      } as AgentTask
    })
  })

  const completedCount = createMemo(() => agentTasks().filter((t) => t.status === "completed").length)
  const progressPercent = createMemo(() => {
    const total = agentTasks().length
    if (total === 0) return 0
    return Math.round((completedCount() / total) * 100)
  })

  const navigateToSession = (sessionID: string) => {
    if (params.serverKey) {
      navigate(sessionHref(requireServerKey(params.serverKey), sessionID))
      return
    }
    const dir = sdk().directory
    const slug = btoa(dir).replace(/=/g, "")
    navigate(`/${slug}/session/${sessionID}`)
  }

  const statusIcon = (status: AgentTask["status"]) => {
    switch (status) {
      case "running":
        return "●"
      case "completed":
        return "✅"
      case "failed":
        return "❌"
      case "pending":
        return "⏳"
    }
  }

  return (
    <div class="flex flex-col h-full bg-v2-background-bg-base border-l border-v2-border-border-base">
      <div class="flex items-center justify-between px-4 py-3 border-b border-v2-border-border-base">
        <div class="flex items-center gap-2">
          <span class="text-14-medium text-v2-text-text-base">Agent Panel</span>
          <span class="text-12-regular text-v2-text-text-muted">{agentTasks().length} agents</span>
        </div>
        <button
          class="text-v2-text-text-muted hover:text-v2-text-text-base"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <For each={agentTasks()}>
          {(task) => (
            <div class="px-4 py-3 border-b border-v2-border-border-base hover:bg-v2-background-bg-tertiary cursor-pointer"
              onClick={() => navigateToSession(task.session.id)}
            >
              <div class="flex items-start gap-2">
                <span class="text-14-regular mt-0.5">{statusIcon(task.status)}</span>
                <div class="flex-1 min-w-0">
                  <div class="text-13-medium text-v2-text-text-base truncate">
                    Task {task.index}/{task.total}: {task.description}
                  </div>
                  <div class="text-12-regular text-v2-text-text-muted mt-1">
                    Status: {task.status}
                    <Show when={task.status === "running"}>
                      <span class="ml-2">...</span>
                    </Show>
                  </div>
                  <Show when={task.status === "completed"}>
                    <div class="text-12-regular text-v2-text-text-muted mt-1">
                      Modified: {task.session.summary?.files ?? 0} files
                    </div>
                  </Show>
                </div>
              </div>
              <div class="text-12-regular text-v2-text-text-muted mt-2 text-v2-interactive-interactive hover:underline">
                View conversation →
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="px-4 py-3 border-t border-v2-border-border-base">
        <div class="text-12-regular text-v2-text-text-muted mb-2">
          Progress: {completedCount()}/{agentTasks().length} completed
        </div>
        <div class="w-full h-2 bg-v2-background-bg-secondary rounded-full overflow-hidden">
          <div
            class="h-full bg-v2-interactive-interactive transition-all duration-300"
            style={{ width: `${progressPercent()}%` }}
          />
        </div>
        <div class="text-12-regular text-v2-text-text-muted mt-1 text-center">{progressPercent()}%</div>
      </div>
    </div>
  )
}
