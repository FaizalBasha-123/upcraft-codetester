import { SessionV1 } from "@agenthorsy-ai/core/v1/session"
import type { Checkpoint, ChannelVersions } from "@langchain/langgraph-checkpoint"
import { ulid } from "ulid"

export interface AgenthorsyChannelValues {
  messages: SessionV1.WithParts[]
  todos: Array<{ content: string; status: string }>
  tokenUsage: { input: number; output: number; reasoning: number }
  step: number
  pendingToolCalls: Array<{ tool: string; callID: string; input: unknown }>
  completedToolCalls: Array<{ tool: string; callID: string; output: string }>
  orchestratorMetadata?: Record<string, unknown>
  currentTaskIndex?: number
  results?: Array<{ taskIndex: number; childSessionID: string; summary: string }>
}

export function serializeToCheckpoint(
  state: AgenthorsyChannelValues,
  existing?: Checkpoint,
): Checkpoint {
  return {
    v: 4,
    id: existing?.id ?? ulid(),
    ts: new Date().toISOString(),
    channel_values: state as unknown as Record<string, unknown>,
    channel_versions: existing?.channel_versions ?? {},
    versions_seen: existing?.versions_seen ?? {},
  }
}

export function deserializeFromCheckpoint(checkpoint: Checkpoint): AgenthorsyChannelValues {
  return checkpoint.channel_values as unknown as AgenthorsyChannelValues
}

export function createEmptyCheckpoint(): Checkpoint {
  return {
    v: 4,
    id: ulid(),
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  }
}
