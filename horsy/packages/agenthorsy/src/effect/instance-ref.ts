import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@agenthorsy-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~agenthorsy/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~agenthorsy/WorkspaceRef", {
  defaultValue: () => undefined,
})
