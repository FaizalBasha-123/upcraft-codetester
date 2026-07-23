import { run as runTui, type TuiInput } from "@agenthorsy-ai/tui"
import { Global } from "@agenthorsy-ai/core/global"
import { AppNodeBuilder } from "@agenthorsy-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
