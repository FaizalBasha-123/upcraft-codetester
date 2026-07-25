export * as File from "./file"

import { Revert } from "@agenthorsy-ai/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
