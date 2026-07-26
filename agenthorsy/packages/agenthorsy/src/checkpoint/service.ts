import { Context, Effect } from "effect"
import { Global } from "@agenthorsy-ai/core/global"
import { AgenthorsyCheckpointSaver } from "./saver"
import { serializeToCheckpoint, deserializeFromCheckpoint, type AgenthorsyChannelValues } from "./serializer"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { CheckpointMetadata } from "@langchain/langgraph-checkpoint"
import path from "path"

export interface CheckpointMeta {
  id: string
  timestamp: string
  namespace: string
}

export interface Interface {
  readonly save: (
    sessionID: string,
    agentType: string,
    state: AgenthorsyChannelValues,
  ) => Effect.Effect<void>
  readonly load: (
    sessionID: string,
    agentType: string,
  ) => Effect.Effect<AgenthorsyChannelValues | null>
  readonly list: (sessionID: string) => Effect.Effect<CheckpointMeta[]>
  readonly prune: (sessionID: string, keepLast?: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@agenthorsy/CheckpointService") {}

function makeConfig(sessionID: string, agentType: string): RunnableConfig {
  return {
    configurable: {
      thread_id: sessionID,
      checkpoint_ns: agentType,
    },
  }
}

function dbPath(): string {
  return path.join(Global.Path.data, "agenthorsy-checkpoints.db")
}

let saverInstance: AgenthorsyCheckpointSaver | undefined

function getSaver(): AgenthorsyCheckpointSaver {
  if (!saverInstance) {
    saverInstance = new AgenthorsyCheckpointSaver(dbPath())
  }
  return saverInstance
}

export const layer = Effect.succeed(
  Service.of({
    save: Effect.fn("CheckpointService.save")(function* (
      sessionID: string,
      agentType: string,
      state: AgenthorsyChannelValues,
    ) {
      const config = makeConfig(sessionID, agentType)
      const saver = getSaver()

      const existing = yield* Effect.tryPromise(() => saver.getTuple(config)).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )

      const checkpoint = serializeToCheckpoint(state, existing?.checkpoint)
      const metadata: CheckpointMetadata = { source: "loop", step: 0, parents: {} }

      yield* Effect.tryPromise(() => saver.put(config, checkpoint, metadata, {})).pipe(
        Effect.orDie,
      )
    }),

    load: Effect.fn("CheckpointService.load")(function* (sessionID: string, agentType: string) {
      const config = makeConfig(sessionID, agentType)
      const saver = getSaver()

      const tuple = yield* Effect.tryPromise(() => saver.getTuple(config)).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )

      if (!tuple) return null
      return deserializeFromCheckpoint(tuple.checkpoint)
    }),

    list: Effect.fn("CheckpointService.list")(function* (sessionID: string) {
      const config = { configurable: { thread_id: sessionID } }
      const saver = getSaver()

      const checkpoints: CheckpointMeta[] = []
      yield* Effect.tryPromise(async () => {
        for await (const tuple of saver.list(config)) {
          checkpoints.push({
            id: tuple.checkpoint.id,
            timestamp: tuple.checkpoint.ts,
            namespace: (tuple.config.configurable?.checkpoint_ns as string) ?? "",
          })
        }
      }).pipe(Effect.catch(() => Effect.void))

      return checkpoints
    }),

    prune: Effect.fn("CheckpointService.prune")(function* (sessionID: string, keepLast = 5) {
      const checkpoints = yield* Service.pipe(Effect.flatMap((svc) => svc.list(sessionID)))
      if (checkpoints.length <= keepLast) return

      const saver = getSaver()
      const toDelete = checkpoints
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(keepLast)

      for (const cp of toDelete) {
        yield* Effect.tryPromise(() => saver.deleteThread(sessionID)).pipe(
          Effect.catch(() => Effect.void),
        )
      }
    }),
  }),
)

export * as CheckpointService from "./service"
