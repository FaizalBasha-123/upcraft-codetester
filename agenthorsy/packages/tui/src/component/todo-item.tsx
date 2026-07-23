import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
  context?: { criterion: number; verification: string; files?: string[] }
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={0}>
        <text
          flexShrink={0}
          style={{
            fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
          }}
        >
          [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
        </text>
        <text
          flexGrow={1}
          wrapMode="word"
          style={{
            fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
          }}
        >
          {props.content}
        </text>
      </box>
      {props.context && (
        <text
          flexShrink={0}
          style={{ fg: theme().textMuted }}
        >
          {"  "}#{props.context.criterion} | {props.context.verification}
        </text>
      )}
    </box>
  )
}
