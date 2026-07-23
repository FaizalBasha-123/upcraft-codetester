export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"

export const TodoContext = Schema.Struct({
  criterion: Schema.Number.annotate({ description: "Acceptance criterion number this todo maps to (e.g. 1, 2, 3)" }),
  verification: Schema.String.annotate({
    description: "Verification step — what to check after this todo is completed (gating or evidence)",
  }),
  files: Schema.Array(Schema.String).annotate({ description: "Files that need to be modified for this todo" }),
}).annotate({ identifier: "TodoContext" })
export interface TodoContext extends Schema.Schema.Type<typeof TodoContext> {}

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({
    description: "Priority level of the task: high, medium, low",
  }),
  context: Schema.optional(TodoContext).annotate({
    description: "Plan execution context — criterion number, verification step, and affected files",
  }),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
