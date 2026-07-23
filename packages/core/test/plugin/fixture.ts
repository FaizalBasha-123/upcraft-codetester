import { AgentV2 } from "@agenthorsy-ai/core/agent"
import { AISDK } from "@agenthorsy-ai/core/aisdk"
import { Catalog } from "@agenthorsy-ai/core/catalog"
import { CommandV2 } from "@agenthorsy-ai/core/command"
import { Credential } from "@agenthorsy-ai/core/credential"
import { AppNodeBuilder } from "@agenthorsy-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@agenthorsy-ai/core/effect/app-node-platform"
import { LayerNode } from "@agenthorsy-ai/core/effect/layer-node"
import { EventV2 } from "@agenthorsy-ai/core/event"
import { FileSystem } from "@agenthorsy-ai/core/filesystem"
import { FSUtil } from "@agenthorsy-ai/core/fs-util"
import { Integration } from "@agenthorsy-ai/core/integration"
import { Location } from "@agenthorsy-ai/core/location"
import { Npm } from "@agenthorsy-ai/core/npm"
import { PluginV2 } from "@agenthorsy-ai/core/plugin"
import { Reference } from "@agenthorsy-ai/core/reference"
import { SkillV2 } from "@agenthorsy-ai/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
