import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260722195400_add_todo_context",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`todo\`)`)
      if (columns.some((col) => col.name === "context")) return
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`context\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
