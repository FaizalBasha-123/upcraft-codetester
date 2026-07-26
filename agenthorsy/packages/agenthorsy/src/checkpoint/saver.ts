import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type { Checkpoint, CheckpointMetadata, CheckpointTuple, CheckpointListOptions, ChannelVersions, PendingWrite } from "@langchain/langgraph-checkpoint"
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite"
import type { RunnableConfig } from "@langchain/core/runnables"

export class AgenthorsyCheckpointSaver extends BaseCheckpointSaver {
  private sqlite: SqliteSaver

  constructor(dbPath: string) {
    super()
    this.sqlite = SqliteSaver.fromConnString(dbPath)
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    return this.sqlite.getTuple(config)
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    yield* this.sqlite.list(config, options)
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    return this.sqlite.put(config, checkpoint, metadata, newVersions)
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    return this.sqlite.putWrites(config, writes, taskId)
  }

  async deleteThread(threadId: string): Promise<void> {
    return this.sqlite.deleteThread(threadId)
  }
}
