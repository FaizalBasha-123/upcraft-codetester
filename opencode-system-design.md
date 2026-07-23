# OpenCode System Design Reference

> Deep architecture analysis of OpenCode v1.17.13 — an AI-powered development tool
> with 7 agents, 17 built-in tools, full MCP support, plugin system, multi-workspace
> control plane, and ACP protocol for IDE integration.
>
> Last generated: 2026-07-12 | Source: opencode-repo (git dev)

---

## 1. Philosophy & Core Architecture

### OpenCode's Approach

OpenCode is an **agent-powered coding assistant** that runs as a local server with
multiple client frontends (TUI, CLI, desktop Electron, Web, VS Code via ACP).
Unlike oh-my-openagent's 11-agent orchestration, OpenCode keeps a lean 7-agent
core with an extensible plugin/MPC system for customization.

| Philosophy | Implementation |
|---|---|
| **Effect-first architecture** | Entire codebase uses Effect-TS for DI, error handling, streaming, async composition |
| **Schema-driven** | All wire formats, configs, and errors defined with Effect Schema |
| **Permission-gated capabilities** | Every tool action runs through `Permission.evaluate()` with agent+session rules |
| **Plugin-extensible** | Plugins add tools, modify tool behavior, inject shell env, observe events, add auth providers |
| **Multi-client** | TUI (Ink React), CLI (Yargs), Desktop (Electron), Web, IDE (ACP stdin/stdout) |
| **Multi-workspace** | Control plane for session migration between local worktrees and remote workspaces |
| **Event-sourced** | Durable EventV2 system with sequence numbers enables cross-workspace sync |

### Architecture Layers

```
   CLI / TUI / Desktop / Web / ACP
         |           |
    Yargs CLI     HTTP API
         |           |
    effectCmd   Effect Router
         |           |
    InstanceContext (per-directory scope)
         |
    Core Services:
    Agent | Tool | Session | MCP | Plugin | Permission | LSP | Provider | Skill | Command | Event
         |
    Effect Layers:
    Config | Project | Worktree | Auth | Storage | DB | Git | Background
         |
    Packaged Services (from @opencode-ai/core):
    SessionStore | EventV2 | BackgroundJob | LLM | Identity
```

All services are composed via the **LayerNode** system (`AppNodeBuilderV1`) which
auto-scopes services as either global (process-wide) or per-instance (per-directory).

---

## 2. The 7 Native Agents

All defined in `packages/opencode/src/agent/agent.ts:140-265`.

### 2.1 `build` (primary, visible)
- **Role**: Default day-to-day coding agent
- **Model**: Provider default (no override)
- **Prompt**: Provider-specific (PROMPT_ANTHROPIC, PROMPT_BEAST, etc.)
- **Permissions**: Full access + `question: allow` + `plan_enter: allow`
- **Purpose**: Executes tools with full permissions. The primary agent for all coding work.

### 2.2 `plan` (primary, visible)
- **Role**: Read-only planning/architecture agent
- **Model**: Provider default
- **Prompt**: Provider default
- **Permissions**: `edit: { "*": "deny", ".opencode/plans/*.md": "allow" }`, `question: allow`, `plan_exit: allow`, `task.general: deny`
- **Purpose**: Can reason, read, search but cannot modify files except plan files. Exits via `plan_exit` tool to switch to `build` agent.

### 2.3 `general` (subagent, visible)
- **Role**: General-purpose subagent for parallel task execution
- **Model**: Provider default
- **Permissions**: Full access minus `todowrite: deny`
- **Purpose**: Spawned via `task` tool for complex multi-step work. Has full tool access but cannot write todos.

### 2.4 `explore` (subagent, visible)
- **Role**: Fast codebase search specialist
- **Model**: Provider default
- **Prompt**: `prompt/explore.txt` (18 lines — "file search specialist, return absolute paths, no modifications")
- **Permissions**: `"*": "deny"` then selectively allows: `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, `read`, `external_directory`
- **Purpose**: Read-only codebase exploration. Can search and read but never modify files.

### 2.5 `compaction` (primary, hidden)
- **Role**: Context window summarization
- **Prompt**: `prompt/compaction.txt` (9 lines — "summarize conversation history, update anchored summary")
- **Permissions**: `"*": "deny"` — no tool access
- **Purpose**: Internal agent used to compact conversation history when token limits are approached. Text-only LLM call.

### 2.6 `title` (primary, hidden)
- **Role**: Session title generation
- **Temperature**: 0.5
- **Prompt**: `prompt/title.txt` (44 lines — "≤50 chars, single line, same language as user, no tool names")
- **Permissions**: `"*": "deny"`
- **Purpose**: Generates a concise session title after the first user message. Uses small model when available.

### 2.7 `summary` (primary, hidden)
- **Role**: PR-description-style session summary
- **Prompt**: `prompt/summary.txt` (11 lines — "summarize like a PR description, 2-3 sentences")
- **Permissions**: `"*": "deny"`
- **Purpose**: Generates a summary of what was accomplished. Called after each step-finish.

### Agent Config Extensibility

- **User overrides**: Any agent field can be overridden via `opencode.json` `agent` config
- **Agent disabling**: `"agent": { "explore": { "disable": true } }`
- **Markdown agents**: `{agent,agents}/**/*.md` files parsed with YAML frontmatter → new agent definitions
- **Markdown modes**: `{mode,modes}/*.md` files → agents with `mode: "primary"` forced
- **AI generation**: `opencode agent create` — `PROMPT_GENERATE` (75 lines) uses LLM to generate `{identifier, whenToUse, systemPrompt}` from natural language

---

## 3. The 17 Built-in Tools

All defined in `packages/opencode/src/tool/`. Every tool follows the `Tool.Def` interface:
`{ id, description, parameters, jsonSchema, execute, formatValidationError }`.

### Core File Tools
| # | ID | File | Purpose | Permission |
|---|-----|------|---------|------------|
| 1 | `bash` | `shell.ts` (645L) | Executes shell commands (bash/PS/cmd) with AST parsing, path resolution, output truncation | `bash`, `external_directory` |
| 2 | `read` | `read.ts` (386L) | Reads files/directories, images, PDFs with line numbers, byte cap, warm LSP | `read`, `external_directory` |
| 3 | `edit` | `edit.ts` (737L) | Search-and-replace with 9 fallback strategies (exact→trimmed→anchored→Levenshtein→whitespace→indent→escape→context→multi) | `edit`, `external_directory` |
| 4 | `write` | `write.ts` (104L) | Create/overwrite files with BOM preservation | `edit` |
| 5 | `apply_patch` | `apply_patch.ts` (313L) | Patch-based editing (Begin/End patch format) for GPT models | `edit` |
| 6 | `glob` | `glob.ts` (76L) | File pattern matching via ripgrep (100 result limit) | `glob` |
| 7 | `grep` | `grep.ts` (112L) | Regex content search via ripgrep (100 match limit) | `grep` |

### Delegation & Interaction Tools
| # | ID | File | Purpose | Permission |
|---|-----|------|---------|------------|
| 8 | `task` | `task.ts` (346L) | Delegate to subagent (foreground/background, session resumption via `task_id`) | `task` |
| 9 | `question` | `question.ts` (44L) | Ask user questions with options/multi-select/custom | (gated by agent config) |
| 10 | `todowrite` | `todo.ts` (46L) | Structured task list (pending/in_progress/completed/cancelled) | `todowrite` |

### Web & Search Tools
| # | ID | File | Purpose | Permission |
|---|-----|------|---------|------------|
| 11 | `webfetch` | `webfetch.ts` (192L) | Fetch URL content (text/markdown/html, Cloudflare bypass, image attachments, 5MB/120s limits) | `webfetch` |
| 12 | `websearch` | `websearch.ts` (143L) | Real-time web search via Exa/Parallel providers (MCP-style JSON-RPC) | `websearch` |

### Intelligence & Integration Tools
| # | ID | File | Purpose | Permission |
|---|-----|------|---------|------------|
| 13 | `lsp` | `lsp.ts` (113L) | LSP operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, callHierarchy, incoming/outgoing calls | `lsp`, `external_directory` |
| 14 | `skill` | `skill.ts` (70L) | Load specialized skill instructions into context | `skill` |
| 15 | `plan_exit` | `plan.ts` (79L) | Switch from plan agent to build agent (synthetic user message) | (gated by agent config) |
| 16 | `execute` | `code-mode.ts` (317L) | Run JS/TS orchestrating MCP tools in sandboxed runtime | (delegated to MCP tools) |

### Error/Placeholder
| # | ID | File | Purpose |
|---|-----|------|---------|
| 17 | `invalid` | `invalid.ts` (21L) | Placeholder for invalid tool calls (returns "Do not use" message) |

### Tool Execution Flow

```
LLM requests tool call
  → Tool.Def.execute(args, ctx)
    → Schema.decodeUnknown(params) validates args
    → ctx.ask({ permission, patterns }) — Permission.evaluate()
      → "allow": proceed
      → "deny": throw DeniedError
      → "ask": block → publish permission event → user responds
    → Execute tool logic
    → Truncate.output(text) if exceeds 2000 lines / 50KB
    → Return { title, metadata, output, attachments }
```

### 9 Fallback Edit Strategies (in order)

| # | Strategy | Matching |
|---|----------|----------|
| 1 | `SimpleReplacer` | Exact string match |
| 2 | `LineTrimmedReplacer` | Whitespace-trimmed lines |
| 3 | `BlockAnchorReplacer` | First/last line anchors + Levenshtein similarity |
| 4 | `WhitespaceNormalizedReplacer` | Collapse whitespace |
| 5 | `IndentationFlexibleReplacer` | Strip consistent indentation |
| 6 | `EscapeNormalizedReplacer` | Unescape strings before match |
| 7 | `TrimmedBoundaryReplacer` | Trim leading/trailing whitespace |
| 8 | `ContextAwareReplacer` | Context anchor + 50% middle-line similarity |
| 9 | `MultiOccurrenceReplacer` | Find all occurrences |

---

## 4. Session System

### Lifecycle

```
CREATE → prompt() → LOOP(agent:resolve, tools:filter, system:assemble)
                      → LLM.stream()
                      → handleEvent(text|reasoning|tool-calls|step-finish)
                      → subtask? → TaskTool spawns child session
                      → compaction? → compaction agent summarizes
                      → overflow? → trigger compaction → auto-continue
                      → loop completes → return lastAssistant
RESUME (same sessionID, new prompt) → reload history → re-enter loop
FORK → clone session up to messageID → remap IDs → independent
REVERT → walk to target → snapshot → restore on unrevert
DELETE → cancel background jobs → recursive child deletion → pub event
```

### Key Session Components

- **`prompt.ts`** (1631L): Prompt input, user message creation, run loop, subtask handling, title generation, shell execution, command execution
- **`processor.ts`** (718L): LLM stream processing, event handling, tool call tracking, doom loop detection (3 identical calls), cleanup
- **`compaction.ts`** (562L): Overflow detection, message pruning, LLM summarization with compaction agent

### Context Architecture (Epochs & Baselines)

OpenCode sharply separates **System Context** (the structured contextual facts) from **Session History** (the chronological conversation):
- **Context Epoch**: The span during which one initially rendered System Context remains the immutable provider-cache baseline.
- **Baseline System Context**: The full System Context rendered at the start of an epoch. It is stored durably and reused verbatim to maximize LLM prompt caching.
- **Mid-Conversation System Message**: When dynamic context changes (e.g., branch switch), instead of invalidating the baseline, OpenCode injects a durable chronological instruction telling the model about the updated state.
- **Session Drain**: A process-local execution span that promotes eligible input and runs required Provider Turns until no immediate continuation remains.

### SDK & Embedded Architecture

- **SDK Contract IR**: The runtime-neutral compiled representation of the authoritative `HttpApi`, used to generate both Promise and Effect clients.
- **Embedded OpenCode**: A scoped in-process host that uses the exact same Client APIs but via an in-memory `HttpClient` (bypassing network I/O), ensuring 100% parity between CLI/TUI and network clients.

### Session Parameters

- **`run-state.ts`**: Per-session runner management, idle/busy tracking, cascading cancellation
- **`retry.ts`**: Exponential backoff (2s initial, 2x factor), rate limit/overload detection, context overflow bailout
- **`llm.ts`** (404L): Dual runtime selection — AI SDK (default) or native `@opencode-ai/llm` (experimental)
- **`tools.ts`** (590L): Tool resolution for each LLM call — registry tools + MCP resource tools + MCP catalog tools, permission filtering, plugin hooks
- **`system.ts`** (143L): System prompt assembly — provider-specific templates + environment + skills + MCP instructions
- **`instruction.ts`**: AGENTS.md/CLAUDE.md/CONTEXT.md loading from project hierarchy + remote URLs
- **`message-v2.ts`**: Database-backed message storage with cursor pagination, compaction-aware reordering, model message conversion
- **`reminders.ts`**: Injects plan-mode constraints, build-switch instructions into user messages

### Session Parameters

| Parameter | Description |
|-----------|-------------|
| `model` | Model override per message |
| `agent` | Agent selection per message |
| `noReply` | Admit-only mode (no LLM call) |
| `tools` | Tool permission overrides |
| `format` | Output format (text/structured) |
| `variant` | Model variant (effort level) |
| `system` | Extra system prompt content |
| `parts` | Text/File/Agent/Subtask input parts |

---

## 5. LLM Provider System

Defined in `packages/opencode/src/provider/`.

### Provider Discovery & Resolution

- **Model registry**: Fetches from `models.dev` (external API) with background refresh
- **Provider resolution**: Fuzzy matching (`claude` → `anthropic`)
- **Model resolution**: Fuzzy matching (`claude-3.5-sonnet` → `claude-3-5-sonnet-20241022`)
- **SDK adapter mapping**: Each provider maps to an AI SDK adapter key
- **Auth methods**: `api-key` (manual), `oauth` (browser PKCE), `cloud` (managed)
- **Model variants**: Effort levels as model variants (`low`, `medium`, `high`)

### Supported Providers

OpenAI, Anthropic, Google/Gemini, AWS Bedrock, GitHub Copilot, Azure, Groq, X.ai, DeepSeek, Moonshot, Fireworks, OpenRouter, Kimi, plus all OpenAI-compatible providers.

### Dual LLM Runtime

| Path | Default | Provider Support |
|------|---------|-----------------|
| **AI SDK** (`ai-sdk.ts`) | ✅ Default | All providers via Vercel AI SDK adapters |
| **Native** (`native-runtime.ts`) | ❌ Experimental | OpenAI, Anthropic, opencode-managed only |

### Request Pipeline

```
LLMRequestPrep.prepare()
  → system: agent.prompt|provider default + env + instructions + skills + MCP
  → messages: converted to provider-specific format via Provider.transform
  → tools: filtered by permission, adapted per provider schema
  → model params: temperature, topP, maxTokens, variant/effort
  → provider transform: image/audio/PDF modality adaptation
  → LLM stream
  → LLMEvent stream: reasoning, text, tool-input, tool-call, tool-result, step
```

---

## 6. Permission System

Defined in `packages/opencode/src/permission/index.ts` (223L).

### Evaluation Model

```typescript
evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule
```

- Finds **last matching rule** across flattened rulesets using wildcard matching
- Returns `{ action: "allow" | "deny" | "ask" }`
- No match defaults to `{ action: "ask" }` — user must approve

### Ruleset Sources

1. **Agent permissions** — defined in agent config
2. **Session permissions** — passed per message via `tools` field
3. **Approved list** — user-approved "always allow" rules persisted in-session

### Permission Domains

| Domain | Pattern | Tools Affected |
|--------|---------|---------------|
| `bash` | `"bash"` | Shell commands |
| `read` | `"read"` | Read tool |
| `edit` | `"edit"` | Edit, Write, ApplyPatch |
| `glob` | `"glob"` | Glob tool |
| `grep` | `"grep"` | Grep tool |
| `task` | `"task.{agent}"` | Task tool (per subagent type) |
| `todowrite` | `"todowrite"` | Todowrite tool |
| `webfetch` | `"webfetch"` | Webfetch tool |
| `websearch` | `"websearch"` | Websearch tool |
| `question` | `"question"` | Question tool |
| `plan_enter` | `"plan_enter"` | Plan mode entry |
| `plan_exit` | `"plan_exit"` | Plan mode exit |
| `skill` | `"skill"` | Skill tool |
| `lsp` | `"lsp"` | LSP tool |
| `external_directory` | `"external_directory"` | File access outside project |

### Bash Arity System

`permission/arity.ts` (163L) — Maps shell command prefixes to their arity for
fine-grained permission matching:
- `git checkout main` → `"git checkout"` (arity 2)
- `npm run dev` → `"npm run dev"` (arity 3)
- Default: first token only (arity 1)

---

## 7. MCP System

Defined in `packages/opencode/src/mcp/` (6 files, ~1700L combined).

### MCP Server Types

| Type | Transport | Use Case |
|------|-----------|----------|
| **STDIO** | stdin/stdout | Local CLI tools (e.g., `npx @modelcontextprotocol/server-filesystem`) |
| **SSE** | Server-Sent Events | Remote servers with HTTP streaming |
| **StreamableHTTP** | HTTP POST | Remote servers with request/response streaming |

### OAuth Flow for Remote MCP Servers

1. Client sends `saml2_start` OAuth request
2. `oauth-callback.ts` starts local HTTP server on port 19876
3. Browser opens for user authorization
4. Callback captures `authorization_code` → exchanges for tokens
5. Credentials stored in `mcp-auth.json`

### MCP Tool Integration

- MCP server tools are registered in the tool catalog alongside built-in tools
- Each MCP tool call goes through `ctx.ask()` for permission
- MCP resource tools (list_mcp_resources, list_mcp_resource_templates, read_mcp_resource) are added when servers have resource capability
- Tools are grouped by server in the CodeMode `execute` tool description

### MCP Configuration

Defined in `opencode.json`:
```json
{
  "mcp": {
    "server-name": {
      "type": "local" | "remote",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ..." },
      "env": { "KEY": "value" }
    }
  }
}
```

---

## 8. Plugin System

Defined in `packages/opencode/src/plugin/` (14 files).

### Plugin Loading

1. **Config scan**: Reads `plugin` field from `opencode.json`
2. **Directory scan**: `{plugin,plugins}/*.{ts,js}`, `.claude/`, `.agents/`
3. **Resolution**: `parsePluginSpecifier()` → `resolvePluginTarget()` (npm install or file resolve)
4. **Loading**: Dynamic import → `createPluginEntry()` (detect server/TUI entrypoints)
5. **Compatibility check**: Semver engine range validation

### Plugin Hooks

| Hook | Trigger Point | Purpose |
|------|---------------|---------|
| `tool.definition` | Tool registration | Modify tool descriptions/schemas |
| `tool.execute.before` | Before tool execution | Pre-processing/validation |
| `tool.execute.after` | After tool execution | Post-processing/observability |
| `shell.env` | Shell execution | Inject environment variables |
| `chat.message` | Message persistence | Inspect/modify messages |
| `chat.params` | LLM request | Modify LLM request parameters |
| `command.execute.before` | Command execution | Pre-process commands |
| `event` | Any event | Receive session events |

### Built-in Auth Plugins

Codex (OpenAI OAuth with PKCE + WebSocket pool), Copilot (GitHub device code), GitLab, Poe, Cloudflare Workers, Cloudflare AI Gateway, Azure, DigitalOcean, Snowflake Cortex, X.ai.

### Plugin Schema

```typescript
interface Plugin {
  name?: string
  version?: string
  description?: string
  hooks?: Partial<{
    "tool.definition"(input, tool): Promise<Tool.Definition>
    "tool.execute.before"(input, args): Promise<void>
    "tool.execute.after"(input, args, result): Promise<void>
    "shell.env"(input): Promise<Record<string, string>>
    "chat.message"(input, message): Promise<Message>
    "chat.params"(input, params): Promise<Params>
    "command.execute.before"(input): Promise<void>
    "event"(input, event): Promise<void>
  }>
  tool?: Record<string, ToolDefinition>
  workspaceAdapters?: Record<string, WorkspaceAdapter>
}
```

---

## 9. Server Architecture & API

### Server Stack

```
Bun HTTP Server
  → webHandler (HttpRouter.toWebHandler)
  → Middleware Stack:
      CORS → Compression → CORS Vary Fix → Fence → Schema Error → Authorization
  → Route Groups:
      Global (/health, /event, /config)
      Instance (/session/*, /vcs/*, /agent, /command, /skill, /lsp)
      Config (/config, /provider)
      Control Plane (/experimental/control-plane/*)
      Experimental (/experimental/tool, /experimental/session, /experimental/worktree)
```

### Middleware

| Middleware | Purpose |
|------------|---------|
| **Authorization** | HTTP Basic Auth + query param token bypass for WebSocket |
| **Instance Context** | Loads per-directory Instance from InstanceStore |
| **Workspace Routing** | Determines local/remote/proxy routing for multi-workspace |
| **Schema Error** | Catches decode failures → `InvalidRequestError` |
| **Error/Defect** | Unhandled errors → 500 with correlation ID |
| **Proxy** | HTTP + WebSocket proxy to remote workspace targets |
| **Fence** | Sync state tracking via event sequence numbers |
| **Compression** | Gzip/deflate for responses > 1KB |
| **Lifecycle** | Instance disposal/reload after response |

### API Surface (~50+ endpoints)

**Session**: CRUD, prompt (sync+async), fork, share, revert, abort, shell, command, summarization, permissions, messages (list/get/delete/update parts)
**Instance**: dispose, path, vcs (status/diff/apply), agents, commands, skills, lsp, formatter
**Config**: read, update, providers
**Provider**: list, auth methods, OAuth flow
**Event**: SSE streams (per-instance + global)
**Control Plane**: move session, workspace CRUD
**Experimental**: tools, worktrees, resources, background subagents

---

## 10. CLI Commands

Yargs-based CLI with `effectCmd` wrapper that auto-provides Effect runtime and InstanceContext.

| Command | Description |
|---------|-------------|
| `opencode` | Launch TUI (default) |
| `opencode run` | Non-interactive + interactive prompt (Ink React UI) |
| `opencode serve` | Headless HTTP server |
| `opencode web` | Launch web UI in browser |
| `opencode acp` | ACP server over stdin/stdout |
| `opencode agent` | Agent CRUD (create/list/inspect/delete/enable/disable) |
| `opencode session` | Session management (list/delete) |
| `opencode providers` | Provider auth (login/api-key/interactive) |
| `opencode models` | List available models |
| `opencode stats` | Token/cost statistics |
| `opencode mcp` | MCP server management (add/remove/inspect/auth) |
| `opencode plug` | Plugin installation |
| `opencode account` | Account/org management |
| `opencode generate` | Code generation |
| `opencode export`/`import` | Session export/import |
| `opencode github` | GitHub integration |
| `opencode pr` | Pull request creation |
| `opencode cmd` | Execute named command |
| `opencode attach` | Attach to running session |
| `opencode db` | Direct SQLite access |
| `opencode upgrade` | Self-upgrade |
| `opencode uninstall` | Remove opencode |

---

## 11. Skill System

Defined in `packages/opencode/src/skill/`.

### Skill Sources

1. `{skill,skills}/**/SKILL.md` directories (global + project)
2. `.claude/skills/` and `.agents/skills/` (Claude Code compatibility)
3. Remote discovery via HTTPS (`skills.opencode.ai`)
4. Built-in: `customize-opencode`

### Skill Structure

```yaml
# SKILL.md frontmatter
---
name: skill-name
description: What this skill does
tools: [bash, read, grep]  # optional tool requirements
model: claude-sonnet-4-20250514  # optional model override
---
## Instructions
Markdown body becomes the skill's instructions, injected into agent context
when the skill is loaded via the `skill` tool.
```

### Skill Execution

- `skill` tool loads SKILL.md content and associated files into conversation context
- Skills are also exposed as commands via `Command.fromSkill()`
- Remote skills cached locally with version tracking

---

## 12. Command System

Defined in `packages/opencode/src/command/`.

### Command Sources

1. `opencode.json` `command` field
2. `{command,commands}/**/*.md` files with YAML frontmatter
3. MCP server prompts
4. Skills

### Built-in Commands

| Command | Template | Purpose |
|---------|----------|---------|
| `INIT` | `template/initialize.txt` | Analyze project → generate AGENTS.md |
| `REVIEW` | `template/review.txt` | Code review of staged/unstaged changes |

### Template Substitution

- `$ARGUMENTS` → full argument string
- `$1`, `$2`, etc. → positional arguments
- `` `shell command` `` → inline shell execution in templates
- `/command` execution routes through `session.prompt()` with command template as message

---

## 13. ACP (Agent Client Protocol)

Defined in `packages/opencode/src/acp/` (12 files, ~2300L combined).

### Purpose

Standardized protocol for IDE integration (VS Code, JetBrains, etc.) over
stdin/stdout transport. Wraps OpenCode session system into ACP protocol.

### Capabilities

| Operation | Description |
|-----------|-------------|
| `initialize` | Set up ACP connection with client capabilities |
| `sessions/create` | Create new session |
| `sessions/list` | List ACP sessions |
| `prompt` | Send prompt (maps to `SessionPrompt.prompt`) |
| `fork` | Fork session |
| `abort` | Abort running prompt |
| `model/get`, `model/set` | Current model |
| `effort/get`, `effort/set` | Effort level (low/medium/high) |
| `mode/get`, `mode/set` | Mode (code/chat) |
| `capabilities` | Report server capabilities |
| `configOptions` | List config options (model, effort, mode) |

### Event Bridging

OpenCode `EventV2` → ACP update events:
`session.created`, `session.updated`, `message.created`, `message.updated`,
`part.created`, `part.updated`, `permission.requested`, `question.asked`

### Tool State Tracking

Maps tool calls through their lifecycle:
pending → running → completed/failed.
Extracts file locations from tool calls for IDE display.

---

## 14. Config System

Defined in `packages/opencode/src/config/` (14 files).

### Config Sources (hierarchical, global overridden by project)

1. **Global config**: `~/.config/opencode/config.json` (XDG)
2. **Project config**: `{opencode.json, opencode.jsonc, .opencode/config.json}` (walk up from CWD)
3. **Managed config**: macOS MDM profiles from `/Library/Managed Preferences/`
4. **Env variables**: `{env:VAR_NAME}` substitution in config values
5. **File injection**: `{file:relative/path}` substitution in config values

### Config Schema (opencode.json)

```jsonc
{
  "provider": {
    "<provider-id>": {
      "api": "https://...",
      "models": { "<model-id>": {} },
      "options": { "apiKey": "..." }
    }
  },
  "model": "<provider/model>",
  "agent": { /* per-agent overrides */ },
  "mcp": { "<server>": { "type": "local"|"remote", "command": [...], "url": "..." } },
  "plugin": ["./path-to-plugin"],
  "skill": ["./path-to-skill"],
  "command": { "<name>": "template-string" },
  "experimental": { /* feature flags */ },
  "theme": "...",
  "share": "auto"|"manual",
  "autoCompact": true|false,
  "disableAutoUpdate": true|false,
  "tui": { /* TUI-specific settings */ }
}
```

---

## 15. LSP Integration

Defined in `packages/opencode/src/lsp/` (6 files, ~3300L combined).

### 28 Language Server Configurations (lsp/server.ts:1983L)

Supported via LSP: TypeScript, JavaScript, Python, Rust, Go, Ruby, Java, Kotlin,
C#, C/C++, PHP, Lua, Haskell, Elixir, Dart, Swift, Scala, R, Erlang, OCaml,
Zig, Nim, Crystal, Fortran, COBOL, V, ReScript, Astro.

### LSP Operations (via `lsp` tool)

`goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`,
`goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`

### LSP Integration Points

- **Edit validation**: After `edit`/`write`, runs LSP diagnostics and reports errors
- **Read warm-up**: File reads trigger LSP warm-up
- **Diagnostic formatting**: `diagnostic.ts` formats LSP diagnostics for display
- **File extension mapping**: `language.ts` maps extensions to language IDs

---

## 16. Control Plane / Multi-Workspace

Defined in `packages/opencode/src/control-plane/`.

### Workspace Types

| Type | Description |
|------|-------------|
| `local` | Local directory (worktree) |
| `remote` | Remote server URL with optional auth headers |

### Key Operations

- **`create`**: Create workspace via adapter → insert into DB → start SSE sync → wait for connection
- **`sessionWarp`**: Move session between workspaces — sync history, VCS patch, replay events, transfer ownership
- **`list`**: List workspaces per project
- **`syncList`**: Discover workspaces from adapters and sync to DB
- **`remove`**: CRUD with cascading session cleanup

### Sync Architecture

```
Local ←→ SSE /global/event → Remote
Remote ←→ POST /sync/history → Local (fetch missed events)
```

- SSE backoff: 1s → 2min exponential
- Connection states: disconnected → connecting → connected | error
- Fence-based synchronization: event sequence number diff tracking

### Built-in Adapter: Worktree

Creates git worktrees as isolated workspaces — each worktree gets its own
InstanceContext and independent session storage.

---

## 17. Event System

### EventV2 (Durable)

- Event sourcing with sequence numbers
- Used by: session lifecycle, cross-workspace sync, control plane
- Replay support: `EventV2.replay()` with workspace owner claims

### GlobalBus (In-Memory)

Node.js `EventEmitter` singleton with location-tagged events:
```typescript
{ directory?, project?, workspace?, payload: EventV2.Event }
```

### Event Bridge

`EventV2Bridge` attaches location context → publishes to core EventV2 →
listener re-emits on GlobalBus with workspace/project/directory metadata.

This enables cross-process event distribution for multi-workspace setups.

---

## 18. Background Jobs

Defined in `packages/opencode/src/background/`.

Thin wrapper over `@opencode-ai/core/background-job`:
- Scoped per instance via `InstanceState`
- Operations: list, get, start, extend, wait, waitForPromotion, promote, cancel
- Used by: title generation, summary computation, compaction pruning
- Cascading cancellation: parent session cancel → cancel all child background jobs

---

## 19. Dependency Graph

```
opencode index.ts (CLI entry)
  ├── cli/ (Yargs commands)
  │   ├── cmd/tui.ts → tui/worker.ts
  │   ├── cmd/run/ → runtime + Ink UI (40+ files)
  │   ├── cmd/serve.ts → server/* (HTTP API)
  │   ├── cmd/acp.ts → acp/* (IDE protocol)
  │   └── ...
  ├── agent/ (7 agents + permissions)
  ├── tool/ (17 tools + registry + truncation)
  ├── session/ (prompt, processor, compaction, LLM, retry, tools, system, reminders)
  ├── config/ (hierarchical JSONC + variable + markdown)
  ├── provider/ (model discovery, auth, transform, error)
  ├── mcp/ (servers, OAuth, catalog)
  ├── plugin/ (loader, hooks, auth plugins)
  ├── permission/ (evaluation, arity)
  ├── lsp/ (28 servers, client, diagnostics)
  ├── skill/ (markdown modules, discovery)
  ├── command/ (slash commands, templates)
  ├── control-plane/ (workspaces, adapters, sync)
  ├── server/ (HTTP API, middleware, routes)
  ├── background/ (job management)
  ├── bus/ (GlobalBus event emitter)
  ├── project/ (project management)
  ├── worktree/ (git worktrees)
  ├── git/ (git integration)
  ├── auth/ (authentication)
  ├── storage/ (data persistence)
  ├── lsp/ (language server protocol)
  └── ... (+ 30+ packages in monorepo)
```

### Package Dependency Direction

```
Schema ← Core ← Protocol ← Server
                    ↓
Client ← Protocol  (no Core/Server dependency)
         ↓
sdk-next (composes Client + Core + Server)
```

---

## 20. Glossary

| Term | Definition |
|------|------------|
| Agent | Configured LLM instance with role, model, system prompt, and tool permissions |
| ACP | Agent Client Protocol — stdin/stdout protocol for IDE integration |
| Effect | Effect-TS library for TypeScript functional effect system |
| Instance | Per-directory scoped service context with isolated state |
| LayerNode | Service composition system for global vs instance-scoped lifetimes |
| MCP | Model Context Protocol — standardized tool/resource servers |
| Plugin | External code modules with hooks into tool execution, events, auth |
| Session | A conversation with an agent, persisted to SQLite with message history |
| Subagent | Agent spawned via `task` tool for delegated work (child session) |
| Tool | A named capability an agent can invoke (bash, read, edit, etc.) |
| Worktree | Isolated git worktree as a separate workspace |
| Fence | Sync state tracker using event sequence number diffs |
| Compaction | Conversation summarization to free context window space |
| Hashline | (Not in OpenCode core — introduced by oh-my-openagent plugin) |

---

> **Note**: Independent architectural analysis of OpenCode v1.17.13. Built for
> understanding the system design, not for copying code.
