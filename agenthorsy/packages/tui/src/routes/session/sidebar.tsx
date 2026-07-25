import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@agenthorsy-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { useRoute } from "../../context/route"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const { navigate } = useRoute()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const childSessions = createMemo(() => {
    const sessions = sync.data.session ?? []
    return sessions.filter((s) => s.parentID === props.sessionID)
  })

  const childAgentStatus = (sessionID: string) => {
    const messages = sync.data.message[sessionID] ?? []
    const allParts = messages.flatMap((m) => sync.data.part[m.id] ?? [])
    const toolParts = allParts.filter((p) => p.type === "tool" && p.tool === "task")
    const lastPart = toolParts[toolParts.length - 1]
    if (lastPart?.state.status === "running") return "running"
    if (lastPart?.state.status === "completed") return "completed"
    if (lastPart?.state.status === "error") return "failed"
    return "pending"
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "running":
        return "●"
      case "completed":
        return "✅"
      case "failed":
        return "❌"
      case "pending":
        return "⏳"
      default:
        return "•"
    }
  }

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <pluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
              share_url={session()!.share?.url}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session()!.title}</b>
                </text>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={session()!.workspaceID}>
                  <text fg={theme.textMuted}>
                    <Show
                      when={workspace()}
                      fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
                    >
                      {(item) => (
                        <WorkspaceLabel
                          type={item().type}
                          name={item().name}
                          status={project.workspace.status(item().id) ?? "error"}
                          icon
                        />
                      )}
                    </Show>
                  </text>
                </Show>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </pluginRuntime.Slot>
            <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />

            <Show when={childSessions().length > 0}>
              <box marginTop={1} gap={1}>
                <text fg={theme.text}>
                  <b>Child Agents:</b>
                </text>
                <For each={childSessions()}>
                  {(child) => {
                    const status = () => childAgentStatus(child.id)
                    const description = () => child.title.replace(/^Dynamic Persona - /, "")
                    return (
                      <box
                        gap={1}
                        cursor="pointer"
                        onClick={() => navigate({ type: "session", sessionID: child.id })}
                      >
                        <text fg={theme.text}>
                          {statusIcon(status())} {description()}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Open</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
