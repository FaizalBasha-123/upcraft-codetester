# Shannon — Technical Implementation Guide

> **Purpose:** Complete blueprint for building a replica of the Shannon AI-driven security testing framework.  
> **Status:** Mirrors the actual codebase at `/media/faizal-basha/Codespace/upcraft-codetester/shannon`  
> **License:** AGPL-3.0-only

---

## Table of Contents

1. [Directory Structure](#1-directory-structure)
2. [Entry Points](#2-entry-points)
3. [Monorepo & Package Management](#3-monorepo--package-management)
4. [Configuration System](#4-configuration-system)
5. [Type System](#5-type-system)
6. [Infrastructure (Docker)](#6-infrastructure-docker)
7. [CLI Implementation](#7-cli-implementation)
8. [Temporal Workflow Engine](#8-temporal-workflow-engine)
9. [Agent System](#9-agent-system)
10. [AI Execution Engine](#10-ai-execution-engine)
11. [MCP Collectors](#11-mcp-collectors)
12. [Services Layer](#12-services-layer)
13. [Audit & Metrics System](#13-audit--metrics-system)
14. [Guardrails & Validation](#14-guardrails--validation)
15. [Prompt Templates](#15-prompt-templates)
16. [Interfaces & Extension Points](#16-interfaces--extension-points)
17. [Building & Running](#17-building--running)
18. [Agent ⇄ Deliverable ⇄ Queue Matrix](#18-agent--deliverable--queue-matrix)

---

## 1. Directory Structure

```
shannon/
├── apps/
│   ├── cli/                          # CLI entry (npx @keygraph/shannon)
│   │   ├── src/
│   │   │   ├── index.ts              # CLI dispatch (start, stop, logs, etc.)
│   │   │   ├── commands/             # start.ts, stop.ts, logs.ts, build.ts, etc.
│   │   │   ├── mode.ts               # local vs npx mode detection
│   │   │   ├── paths.ts              # path resolution per mode
│   │   │   ├── splash.ts             # ASCII splash screen
│   │   │   ├── env.ts                # env var loading
│   │   │   ├── docker.ts             # Docker Compose lifecycle
│   │   │   └── config/
│   │   │       ├── writer.ts          # Config file writer
│   │   │       └── resolver.ts        # Config file resolver
│   │   ├── infra/
│   │   │   └── compose.yml           # Docker Compose for Prebuilt / cloud mode
│   │   ├── package.json              # @keygraph/shannon
│   │   ├── tsdown.config.ts          # Bundle config (tsdown bundler)
│   │   └── tsconfig.json
│   │
│   └── worker/                       # Core engine (all pipeline logic)
│       ├── src/
│       │   ├── temporal/             # Temporal workflow orchestration
│       │   ├── types/                # All type definitions
│       │   ├── ai/                   # AI execution engine
│       │   ├── mcp-server/           # MCP collector servers (4)
│       │   ├── services/             # Domain services
│       │   ├── audit/                # Audit & metrics system
│       │   ├── interfaces/           # Injectable extension points
│       │   ├── utils/                # Shared utilities
│       │   ├── session-manager.ts    # Agent definitions (SSOT)
│       │   ├── config-parser.ts      # YAML config → DistributedConfig
│       │   ├── progress-indicator.ts # CLI progress spinner
│       │   └── paths.ts              # Path constants
│       ├── prompts/                  # AI prompt templates (39 files)
│       ├── configs/                  # Schema + examples
│       ├── package.json              # @shannon/worker
│       └── tsconfig.json
│
├── .agents/rules/                    # Agent behavior overrides
│   ├── INSTRUCTIONS.md
│   └── SAFETY_OVERRIDE.md
├── assets/                           # Marketing images
├── .github/
│   ├── workflows/                    # release.yml, release-beta.yml, rollback.yml
│   └── ISSUE_TEMPLATE/
├── Dockerfile                        # Multi-stage: builder → runtime
├── docker-compose.yml                # Temporal Server + optional worker
├── entrypoint.sh                     # UID remapping + privilege drop
├── package.json                      # Root workspace
├── pnpm-workspace.yaml               # Catalog: @anthropic-ai/claude-agent-sdk
├── pnpm-lock.yaml
├── turbo.json                        # Build task orchestration
├── tsconfig.base.json                # Shared TS config
├── tsconfig.json
├── biome.json                        # Linting + formatting
├── .env.example                      # Provider config docs
├── .npmrc
├── .releaserc.json                   # Semantic release
├── AGENTS.md                         # Agent system prompt
├── llms.txt                          # llms.txt for AI discovery
├── shannon                           # Local dev script (invokes Docker)
├── workspaces/                       # Created at runtime (audit logs, sessions)
└── repos/                            # Created at runtime (target repo clones)
```

---

## 2. Entry Points

### 2.1 CLI Entry: `apps/cli/src/index.ts`

```typescript
// Main dispatch — parses command, delegates to handler
const command = process.argv[2];
switch (command) {
  case 'start':     // -u <url> -r <repo> [-c config] [-w workspace] [--pipeline-testing]
  case 'stop':      // [--clean]
  case 'logs':      // <workspace>
  case 'workspaces':
  case 'status':
  case 'setup':     // npx mode only
  case 'build':     // local mode only
  case 'uninstall': // npx mode only
  case 'info':
  case 'help':
}
```

Two modes auto-detected by `mode.ts`:
- **Local mode** (cwd has `Dockerfile` + `docker-compose.yml` + `prompts/`): Runs via Docker Compose, uses `./workspaces/`
- **NPX mode** (run from anywhere): Pulls from Docker Hub, uses `~/.shannon/`

### 2.2 Worker Entry: `apps/worker/dist/temporal/worker.js`

```typescript
// Compiled from apps/worker/src/temporal/worker.ts
// Combined Temporal Worker + Client in a single process.
// Registers workflows + activities, connects to Temporal Server.
```

The worker is the **main runtime** — it connects to Temporal Server, registers all activities and workflows, and executes the pipeline. Built via `tsc`.

### 2.3 Pipeline Entry: `apps/worker/src/temporal/pipeline.ts`

```typescript
// Re-exports for external consumers who want to embed Shannon as a library
export type { ActivityInput, AgentMetrics, PipelineInput, PipelineState, ... } from './activities.js';
export { pentestPipeline } from './workflows.js';
```

### 2.4 Audit Entry: `apps/worker/src/audit/index.ts`

```typescript
export { AuditSession } from './audit-session.js';
// Only AuditSession is public — all other audit internals are private.
```

---

## 3. Monorepo & Package Management

### 3.1 Root `package.json`

```json
{
  "name": "shannon",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "build": "turbo run build",
    "check": "turbo run check",
    "biome": "biome check .",
    "temporal:worker": "node apps/worker/dist/temporal/worker.js"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@types/node": "^25.0.3",
    "turbo": "^2.5.0",
    "typescript": "^5.9.3"
  }
}
```

### 3.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
catalog:
  "@anthropic-ai/claude-agent-sdk": ^0.3.173
```

The catalog pins the Claude Agent SDK version across all packages.

### 3.3 `turbo.json`

```json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"], "inputs": ["src/**/*.ts", "tsconfig.json", "package.json"] },
    "check": { "dependsOn": ["^build"], "inputs": ["src/**/*.ts", "tsconfig.json"] },
    "clean": { "cache": false }
  }
}
```

### 3.4 Package Dependencies

#### `apps/worker/package.json` (@shannon/worker)

| Dependency | Version | Purpose |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | ^0.3.173 | Claude Code SDK for agent execution |
| `@temporalio/activity` | ^1.11.0 | Temporal activity context |
| `@temporalio/client` | ^1.11.0 | Temporal client for workflow start |
| `@temporalio/worker` | ^1.11.0 | Temporal worker runtime |
| `@temporalio/workflow` | ^1.11.0 | Temporal workflow context |
| `ajv` | ^8.12.0 | JSON Schema validation |
| `ajv-formats` | ^2.1.1 | Format validators for AJV |
| `dotenv` | ^16.4.5 | .env loading |
| `js-yaml` | ^4.1.0 | YAML config parsing |
| `zod` | ^4.3.6 | Schema validation (all MCP tools + queues) |
| `zx` | ^8.0.0 | Shell-out for git commands |

#### `apps/cli/package.json` (@keygraph/shannon)

| Dependency | Version | Purpose |
|---|---|---|
| `@clack/prompts` | ^1.1.0 | Interactive prompts |
| `chokidar` | ^5.0.0 | File watching |
| `dotenv` | ^17.3.1 | .env loading |
| `smol-toml` | ^1.6.1 | TOML parsing (alternative config) |
| `tsdown` | ^0.21.5 | Bundle tool (dev dep) |

---

## 4. Configuration System

### 4.1 Config Types (`apps/worker/src/types/config.ts`)

```typescript
export type VulnClass = 'injection' | 'xss' | 'auth' | 'authz' | 'ssrf';
export const ALL_VULN_CLASSES: readonly VulnClass[] = ['injection', 'xss', 'auth', 'authz', 'ssrf'];

export type RetryPreset = 'default' | 'subscription';

export interface Config {
  rules?: Rules;              // avoid/focus rules
  authentication?: Authentication; // login config
  pipeline?: PipelineConfig;  // retry preset + concurrency
  description?: string;       // target description
  vuln_classes?: VulnClass[]; // subset of classes to test
  exploit?: 'true' | 'false'; // skip exploitation
  report?: ReportConfig;      // filter settings
  rules_of_engagement?: string; // free-form engagement rules
}

export interface Authentication {
  login_type: 'form' | 'sso' | 'api' | 'basic';
  login_url: string;
  credentials: Credentials;
  login_flow?: string[];
  success_condition: SuccessCondition; // url_contains | element_present | url_equals_exactly | text_contains
}

export interface DistributedConfig {
  avoid: Rule[];
  focus: Rule[];
  authentication: Authentication | null;
  description: string;
  vuln_classes: VulnClass[];
  exploit: boolean;
  report: ReportConfig;
  rules_of_engagement: string;
}

export interface ProviderConfig {
  providerType?: string;          // anthropic_api | bedrock | vertex | litellm_router
  apiKey?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  gcpRegion?: string;
  gcpProjectId?: string;
  gcpCredentialsPath?: string;
  baseUrl?: string;
  authToken?: string;
  modelOverrides?: Record<string, string>; // per-tier model IDs
  supportsStructuredOutput?: boolean;
}

export interface ContainerConfig {
  deliverablesSubdir: string; // default: '.shannon/deliverables'
  auditDir: string;           // default: './workspaces'
  apiKey?: string;
  promptDir?: string;
  providerConfig?: ProviderConfig;
}
```

### 4.2 `example-config.yaml`

```yaml
description: "Target app description"
authentication:
  login_type: form          # or sso
  login_url: "https://..."
  credentials:
    username: "testuser"
    password: "testpass"
    totp_secret: "..."      # optional 2FA
    email_login:            # optional for magic links
      address: "inbox@..."
      password: "..."
  login_flow:
    - "Type $username into the email field"
    - "Type $password into the password field"
  success_condition:
    type: url_contains      # or element_present
    value: "/dashboard"
rules:
  avoid:
    - description: "Do not test logout"
      type: url_path
      value: "/logout"
  focus:
    - description: "Focus on admin panel"
      type: subdomain
      value: "beta-admin"
pipeline:
  retry_preset: subscription  # or default (6h max retry vs 30min)
  max_concurrent_pipelines: 5 # 1-5
report:
  min_severity: low
  min_confidence: low
rules_of_engagement: "Free-form rules..."
```

### 4.3 `config-schema.json`

Full JSON Schema (draft-07) validating the YAML config. `pipeline.max_concurrent_pipelines` validated as string pattern `^[1-5]$`.

### 4.4 `.env.example`

All provider options documented:
- **Option 1**: Direct Anthropic (`ANTHROPIC_API_KEY`)
- **Option 2**: Custom Base URL (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`)
- **Option 3**: AWS Bedrock (`CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials + model overrides)
- **Option 4**: Google Vertex AI (`CLAUDE_CODE_USE_VERTEX=1` + GCP credentials + model overrides)
- **Model Overrides**: `ANTHROPIC_SMALL_MODEL`, `ANTHROPIC_MEDIUM_MODEL`, `ANTHROPIC_LARGE_MODEL`

---

## 5. Type System

### 5.1 `types/agents.ts`

```typescript
export const ALL_AGENTS = [
  'pre-recon', 'recon',
  'injection-vuln', 'xss-vuln', 'auth-vuln', 'ssrf-vuln', 'authz-vuln',
  'injection-exploit', 'xss-exploit', 'auth-exploit', 'ssrf-exploit', 'authz-exploit',
  'report',
] as const;

export type AgentName = (typeof ALL_AGENTS)[number]; // 13 agents
export type PlaywrightSession = 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5';
export type AgentValidator = (sourceDir: string, logger: ActivityLogger) => Promise<boolean>;
export type AgentStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled-back';

export interface AgentDefinition {
  name: AgentName;
  displayName: string;
  prerequisites: AgentName[];
  promptTemplate: string;
  deliverableFilename: string;
  modelTier?: 'small' | 'medium' | 'large';
}

export type VulnType = 'injection' | 'xss' | 'auth' | 'ssrf' | 'authz';

export interface ExploitationDecision {
  shouldExploit: boolean;
  shouldRetry: boolean;
  vulnerabilityCount: number;
  vulnType: VulnType;
}
```

### 5.2 `types/errors.ts`

```typescript
export enum ErrorCode {
  // Config
  CONFIG_NOT_FOUND, CONFIG_VALIDATION_FAILED, CONFIG_PARSE_ERROR,
  // Agent execution
  AGENT_EXECUTION_FAILED, OUTPUT_VALIDATION_FAILED,
  // Billing
  API_RATE_LIMITED, SPENDING_CAP_REACHED, INSUFFICIENT_CREDITS,
  // Git
  GIT_CHECKPOINT_FAILED, GIT_ROLLBACK_FAILED,
  // Prompt
  PROMPT_LOAD_FAILED,
  // Validation
  DELIVERABLE_NOT_FOUND,
  // Preflight
  REPO_NOT_FOUND, TARGET_UNREACHABLE, AUTH_FAILED, AUTH_LOGIN_FAILED, BILLING_ERROR,
}

export type PentestErrorType = 'config' | 'network' | 'prompt' | 'filesystem' | 'validation' | 'billing' | 'unknown';
```

### 5.3 `types/metrics.ts`

```typescript
export interface AgentMetrics {
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  numTurns: number | null;
  model?: string;
  skipped?: boolean; // True when checkpoint provider skipped (resume path)
}
```

### 5.4 `types/audit.ts`

```typescript
export interface SessionMetadata {
  id: string;
  webUrl: string;
  repoPath?: string;
  outputPath?: string;
  [key: string]: unknown;
}

export interface AgentEndResult {
  attemptNumber: number;
  duration_ms: number;
  cost_usd: number;
  success: boolean;
  model?: string;
  error?: string;
  checkpoint?: string;
  isFinalAttempt?: boolean;
}
```

### 5.5 `temporal/shared.ts`

```typescript
export interface PipelineInput {
  webUrl: string;                      // Target URL (required)
  repoPath: string;                    // Repo path (required)
  configPath?: string;                 // YAML config file path
  outputPath?: string;                 // Deliverable output dir
  pipelineTestingMode?: boolean;       // Use minimal prompts
  pipelineConfig?: PipelineConfig;     // Retry preset + concurrency
  workflowId?: string;                 // Temporal workflow ID
  sessionId?: string;                  // Workspace directory name
  resumeFromWorkspace?: string;        // Resume from existing workspace
  terminatedWorkflows?: string[];      // Terminated during resume
  configYAML?: string;                 // Raw YAML string
  configData?: DistributedConfig;      // Pre-parsed config
  apiKey?: string;                     // API key override
  deliverablesSubdir?: string;         // Deliverable path override
  auditDir?: string;                   // Audit log directory
  promptDir?: string;                  // Prompt template directory
  sastSarifPath?: string;              // External SAST findings
  checkpointsEnabled?: boolean;        // Enable git checkpoints
  providerConfig?: ProviderConfig;     // LLM provider config
  vulnClasses?: VulnClass[];           // Subset of classes
  exploit?: boolean;                   // Enable exploitation
}

export interface PipelineState {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentPhase: string | null;
  currentAgent: string | null;
  completedAgents: string[];
  failedAgent: string | null;
  error: string | null;
  errorCode?: ErrorCode;
  startTime: number;
  agentMetrics: Record<string, AgentMetrics>;
  summary: PipelineSummary | null;
}

export interface ResumeState {
  workspaceName: string;
  originalUrl: string;
  completedAgents: string[];
  checkpointHash: string;
  originalWorkflowId: string;
}
```

---

## 6. Infrastructure (Docker)

### 6.1 `Dockerfile` — Multi-Stage Build

**Builder stage** (`cgr.dev/chainguard/wolfi-base:latest`):
- System: build-base, git, curl, nodejs-22, npm
- Install pnpm@10.33.0
- Copy workspace manifests → `pnpm install --frozen-lockfile`
- Copy source → `pnpm --filter @shannon/worker run build`
- Prune to production deps

**Runtime stage** (minimal wolfi-base):
- Runtime: nodejs-22, python3, chromium, git, bash
- X11 libs for headless Chromium (libx11, libxcomposite, mesa-gbm, etc.)
- System git config: `user.email=agent@localhost`, `safe.directory *`
- Non-root user `pentest` (UID 1001)
- Global installs: `@anthropic-ai/claude-code@2.1.84`, `@playwright/cli@0.1.1`
- Playwright CLI skills install
- Symlinks: `save-deliverable`, `generate-totp` → `/usr/local/bin/`
- ENV: `NODE_ENV=production`, `SHANNON_DOCKER=true`, `PLAYWRIGHT_MCP_EXECUTABLE_PATH=/usr/bin/chromium-browser`
- `ENTRYPOINT ["/app/entrypoint.sh"]`
- `CMD ["node", "apps/worker/dist/temporal/worker.js"]`

### 6.2 `docker-compose.yml`

```yaml
services:
  temporal:
    image: temporalio/temporal:1.7.0
    command: ["server", "start-dev", "--db-filename", "/home/temporal/temporal.db", "--ip", "0.0.0.0"]
    ports:
      - "127.0.0.1:7233:7233"   # gRPC
      - "127.0.0.1:8233:8233"   # Web UI
    volumes:
      - temporal-data:/home/temporal
```

### 6.3 `entrypoint.sh`

```bash
#!/bin/bash
set -euo pipefail
# Reads SHANNON_HOST_UID / SHANNON_HOST_GID
# If set and different from container pentest user:
#   userdel pentest, groupdel pentest
#   groupadd -g $TARGET_GID pentest
#   useradd -u $TARGET_UID -g pentest ...
#   chown -R pentest:pentest /app/sessions /app/workspaces /tmp/.claude
# Then: exec su -m pentest -c "exec $*"
```

---

## 7. CLI Implementation

### 7.1 `apps/cli/src/index.ts` — Main Dispatch

Block sudo, then parse command:
- `start` → parse args (`-u`, `-r`, `-c`, `-w`, `-o`, `--pipeline-testing`, `--debug`) → `start()`
- `stop` → `stop(args.includes('--clean'))`
- `logs` → `logs(workspaceId)`
- `workspaces` → list all workspaces
- `status` → show running workers
- `setup` → configure credentials (npx only)
- `build` → build worker image (local only)
- `info` → splash screen
- `help` → usage text

### 7.2 `mode.ts` — Mode Detection

```typescript
// Auto-detects mode based on cwd contents:
// Local: Dockerfile + docker-compose.yml + prompts/ exist
// NPX: fallback (no local project files)
```

### 7.3 `docker.ts` — Docker Compose Lifecycle

- `start()`: Sets up env, validates Docker availability, runs Docker Compose with appropriate env vars mounted
- `stop()`: Docker Compose down, optionally cleans volumes
- `status()`: Checks container health

### 7.4 `paths.ts` — Path Resolution

```typescript
// Local mode:  ./workspaces/<sessionId>/
// NPX mode:    ~/.shannon/workspaces/<sessionId>/
```

---

## 8. Temporal Workflow Engine

### 8.1 `temporal/workflows.ts` — `pentestPipeline(input)`

The core orchestration function. Execution order:

```
1. Validate repoPath (reject path traversal, require absolute)
2. Select Activity Proxy (testActs | subscriptionActs | acts)
3. Initialize PipelineState (status=running, startTime=now)
4. Register getProgress query handler (real-time status)
5. Build ActivityInput from PipelineInput
6. Determine scope (vulnClasses, exploit flag)
7. persistOrValidateRunScope (save/validate session.json)
8. Conditional resume logic:
   a. loadResumeState → restoreGitCheckpoint → short-circuit check → recordResumeAttempt
9. Phase 0 - Preflight:
   a. runPreflightValidation  (3 retries, 2min timeout)
   b. syncPlaywrightStealthConfig
   c. runAuthenticationValidation  (3 retries, 10min timeout)
   d. initDeliverableGit
   e. syncCodePathDenyRules
10. Phase 1 - Pre-Recon: runPreReconAgent (Opus)
11. Phase 2 - Recon: runReconAgent (Sonnet)
12. Phase 3-4 - Vuln + Exploit (parallel, concurrency-limited):
    For each vuln class in scope:
    a. runVulnAgent → mergeFindingsIntoQueue → checkExploitationQueue → conditional runExploitAgent
13. Phase 5 - Reporting:
    a. assembleReportActivity
    b. runReportAgent (Sonnet)
    c. injectReportMetadataActivity
    d. generateReportOutputActivity
14. Generate final report output
15. Return PipelineState (completed/failed/cancelled)
```

### 8.2 Retry Configurations

| Config | Attempts | Backoff | Timeout | Used For |
|---|---|---|---|---|
| `PRODUCTION_RETRY` | 50 | 5m → 30m ×2 | 2h | Default agents |
| `TESTING_RETRY` | 5 | 10s → 30s ×2 | 30m | pipelineTestingMode |
| `SUBSCRIPTION_RETRY` | 100 | 5m → 6h ×2 | 8h | retry_preset=subscription |
| `PREFLIGHT_RETRY` | 3 | 10s → 1m ×2 | 2m | Preflight checks |
| `AUTH_VALIDATION_RETRY` | 3 | 10s → 1m ×2 | 10m | Auth validation |

**Non-retryable error types** (shared across all configs):
`AuthenticationError`, `PermissionError`, `InvalidRequestError`, `RequestTooLargeError`, `ConfigurationError`, `InvalidTargetError`, `ExecutionLimitError`, `AuthLoginFailedError`

### 8.3 `temporal/activities.ts` — All Activities (33 exports)

| Activity | Signature | Type | Agent? |
|---|---|---|---|
| `runPreReconAgent` | `(input) => Promise<AgentMetrics>` | Sequential | Yes |
| `runReconAgent` | `(input) => Promise<AgentMetrics>` | Sequential | Yes |
| `runInjectionVulnAgent` | `(input) => Promise<AgentMetrics>` | Parallel | Yes |
| `runXssVulnAgent` | `(input) => Promise<AgentMetrics>` | Parallel | Yes |
| `runAuthVulnAgent` | `(input) => Promise<AgentMetrics>` | Parallel | Yes |
| `runSsrfVulnAgent` | `(input) => Promise<AgentMetrics>` | Parallel | Yes |
| `runAuthzVulnAgent` | `(input) => Promise<AgentMetrics>` | Parallel | Yes |
| `runInjectionExploitAgent` | `(input) => Promise<AgentMetrics>` | Parallel* | Yes |
| `runXssExploitAgent` | `(input) => Promise<AgentMetrics>` | Parallel* | Yes |
| `runAuthExploitAgent` | `(input) => Promise<AgentMetrics>` | Parallel* | Yes |
| `runSsrfExploitAgent` | `(input) => Promise<AgentMetrics>` | Parallel* | Yes |
| `runAuthzExploitAgent` | `(input) => Promise<AgentMetrics>` | Parallel* | Yes |
| `runReportAgent` | `(input) => Promise<AgentMetrics>` | Sequential | Yes |
| `runPreflightValidation` | `(input) => Promise<void>` | Sequential | No |
| `runAuthenticationValidation` | `(input) => Promise<void>` | Sequential | No |
| `initDeliverableGit` | `(input) => Promise<void>` | Sequential | No |
| `syncPlaywrightStealthConfig` | `(input) => Promise<void>` | Sequential | No |
| `syncCodePathDenyRules` | `(input) => Promise<void>` | Sequential | No |
| `saveCheckpoint` | `(input, agent, phase, state) => Promise<void>` | Sequential | No |
| `assembleReportActivity` | `(input, exploit) => Promise<void>` | Sequential | No |
| `injectReportMetadataActivity` | `(input) => Promise<void>` | Sequential | No |
| `checkExploitationQueue` | `(input, vulnType) => Promise<ExploitationDecision>` | Per-class | No |
| `mergeFindingsIntoQueue` | `(input, vulnType) => Promise<{mergedCount}>` | Per-class | No |
| `generateReportOutputActivity` | `(input) => Promise<void>` | Sequential | No |
| `loadResumeState` | `(wsName, url, repoPath) => Promise<ResumeState>` | Sequential | No |
| `persistOrValidateRunScope` | `(input, classes, exploit) => Promise<void>` | Sequential | No |
| `restoreGitCheckpoint` | `(repoPath, hash, agents) => Promise<void>` | Sequential | No |
| `recordResumeAttempt` | `(input, terminated, hash, prevId, agents) => Promise<void>` | Sequential | No |
| `logPhaseTransition` | `(input, phase, event) => Promise<void>` | Sequential | No |
| `logWorkflowComplete` | `(input, summary) => Promise<void>` | Sequential | No |

*\*Conditional — only runs if `checkExploitationQueue` returns `shouldExploit=true`*

### 8.4 Error Classification (`temporal/workflow-errors.ts`)

```typescript
const ERROR_TYPE_TO_CODE = {
  AuthenticationError: ErrorCode.AUTH_FAILED,
  BillingError:        ErrorCode.BILLING_ERROR,
  RateLimitError:      ErrorCode.API_RATE_LIMITED,
  ConfigurationError:  ErrorCode.CONFIG_VALIDATION_FAILED,
  OutputValidationError: ErrorCode.OUTPUT_VALIDATION_FAILED,
  AgentExecutionError: ErrorCode.AGENT_EXECUTION_FAILED,
  GitError:            ErrorCode.GIT_CHECKPOINT_FAILED,
  InvalidTargetError:  ErrorCode.TARGET_UNREACHABLE,
};

// formatWorkflowError: "Pipeline failed|ErrorType|message|Hint: ..."
// classifyErrorCode: walks .cause chain to find innermost error with .type
```

---

## 9. Agent System

### 9.1 `session-manager.ts` — Single Source of Truth

#### AGENTS Record (13 definitions)

| Name | Display Name | Prerequisites | Template | Deliverable | Model |
|---|---|---|---|---|---|
| `pre-recon` | Pre-recon agent | — | `pre-recon-code` | `pre_recon_deliverable.md` | `large` (Opus) |
| `recon` | Recon agent | `pre-recon` | `recon` | `recon_deliverable.md` | `medium` (Sonnet) |
| `injection-vuln` | Injection vuln agent | `recon` | `vuln-injection` | `injection_analysis_deliverable.md` | default |
| `xss-vuln` | XSS vuln agent | `recon` | `vuln-xss` | `xss_analysis_deliverable.md` | default |
| `auth-vuln` | Auth vuln agent | `recon` | `vuln-auth` | `auth_analysis_deliverable.md` | default |
| `ssrf-vuln` | SSRF vuln agent | `recon` | `vuln-ssrf` | `ssrf_analysis_deliverable.md` | default |
| `authz-vuln` | Authz vuln agent | `recon` | `vuln-authz` | `authz_analysis_deliverable.md` | default |
| `injection-exploit` | Injection exploit agent | `injection-vuln` | `exploit-injection` | `injection_exploitation_evidence.md` | default |
| `xss-exploit` | XSS exploit agent | `xss-vuln` | `exploit-xss` | `xss_exploitation_evidence.md` | default |
| `auth-exploit` | Auth exploit agent | `auth-vuln` | `exploit-auth` | `auth_exploitation_evidence.md` | default |
| `ssrf-exploit` | SSRF exploit agent | `ssrf-vuln` | `exploit-ssrf` | `ssrf_exploitation_evidence.md` | default |
| `authz-exploit` | Authz exploit agent | `authz-vuln` | `exploit-authz` | `authz_exploitation_evidence.md` | default |
| `report` | Report agent | *all 5 exploit* | `report-executive` | `comprehensive_security_assessment_report.md` | default |

#### Agent Phase Map

```typescript
'pre-recon' → 'pre-recon'
'recon' → 'recon'
'injection-vuln', 'xss-vuln', 'auth-vuln', 'authz-vuln', 'ssrf-vuln' → 'vulnerability-analysis'
'injection-exploit', 'xss-exploit', 'auth-exploit', 'authz-exploit', 'ssrf-exploit' → 'exploitation'
'report' → 'reporting'
```

#### Playwright Session Mapping

| promptTemplate | Session | Phase |
|---|---|---|
| `validate-authentication` | agent1 | Preflight |
| `pre-recon-code` | agent1 | Pre-recon |
| `recon` | agent2 | Recon |
| `vuln-injection`, `exploit-injection` | agent1 | Vuln + Exploit |
| `vuln-xss`, `exploit-xss` | agent2 | Vuln + Exploit |
| `vuln-auth`, `exploit-auth` | agent3 | Vuln + Exploit |
| `vuln-ssrf`, `exploit-ssrf` | agent4 | Vuln + Exploit |
| `vuln-authz`, `exploit-authz` | agent5 | Vuln + Exploit |
| `report-executive` | agent3 | Reporting |

### 9.2 Agent Execution Lifecycle (`services/agent-execution.ts`)

The `execute()` method runs **11 steps** per agent:

```
Step 1:  Load Config        → configData > configYAML > configPath
Step 2:  Load Prompt        → resolve template → interpolate vars → @include() → inject shared
Step 3:  Git Checkpoint     → git add -A + commit (staged state before agent)
Step 4:  Start Audit        → auditSession.startAgent (save prompt, start timer)
Step 5:  Execute SDK        → runClaudePrompt (query() with streaming)
Step 6:  Spending Cap Check → defense-in-depth: $0 + ≤2 turns + billing text → retry
Step 7:  Handle Result      → success → continue / failure → failAgent() + git rollback
Step 8:  Write Structured   → vuln agents only: {type}_exploitation_queue.json
Step 9:  Validate Output    → AGENT_VALIDATORS[agentName] (queue/existence checks)
Step 10: Render Deliverable → writeDeliverable hook (deterministic Markdown)
Step 11: Git Commit Success → commit + capture hash → auditSession.endAgent (mutex-protected)
```

On failure: `failAgent()` → `git reset --hard + git clean -fd` → audit failure → return `PentestError`.

### 9.3 Agent Validators (`session-manager.ts`)

| Agent | Validator | Checks |
|---|---|---|
| `pre-recon` | `() => true` | Always passes (renderer runs after validator) |
| `recon` | `() => true` | Always passes |
| `injection-vuln` | `createVulnValidator('injection')` | `injection_exploitation_queue.json` exists |
| `xss-vuln` | — | Same pattern |
| `auth-vuln` | — | Same pattern |
| `ssrf-vuln` | — | Same pattern |
| `authz-vuln` | — | Same pattern |
| `*‑exploit` | `() => true` | Always passes (renderer races) |
| `report` | inline | `comprehensive_security_assessment_report.md` exists |

---

## 10. AI Execution Engine

### 10.1 `ai/models.ts` — Model Tier Resolution

```typescript
export type ModelTier = 'small' | 'medium' | 'large';

resolveModel('small')  → ANTHROPIC_SMALL_MODEL env  || 'claude-haiku-4-5-20251001'
resolveModel('medium') → ANTHROPIC_MEDIUM_MODEL env || 'claude-sonnet-4-6'
resolveModel('large')  → ANTHROPIC_LARGE_MODEL env  || 'claude-opus-4-8'

supportsAdaptiveThinking(model) → /opus-4-[678]/ test
isFableModel(model) → case-insensitive 'fable' in string
```

### 10.2 `ai/claude-executor.ts` — SDK Execution (`runClaudePrompt`)

```typescript
async function runClaudePrompt(
  prompt: string,
  sourceDir: string,          // cwd for SDK
  context?: string,           // prepended context
  description?: string,       // for progress display
  agentName?: string | null,  // for audit + validation
  auditSession?: AuditSession,
  logger: ActivityLogger,
  modelTier?: ModelTier,
  outputFormat?: JsonSchemaOutputFormat,  // for vuln agents
  apiKey?: string,
  deliverablesSubdir?: string,
  providerConfig?: ProviderConfig,
  mcpServers?: Record<string, McpServerConfig>,
): Promise<ClaudePromptResult>
```

**Internal flow:**
1. Detect execution context (parallel vs clean vs verbose)
2. Set up ProgressManager + AuditLogger (both use Null Object pattern)
3. Build `sdkEnv`:
   - `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`
   - `PLAYWRIGHT_MCP_OUTPUT_DIR=<deliverablesSubdir>/.playwright-cli`
   - Provider-specific env vars (Bedrock: `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_*`, Vertex: `CLAUDE_CODE_USE_VERTEX=1` + `GOOGLE_*`, LiteLLM: `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`)
   - Passthrough: `ANTHROPIC_API_KEY`, `PATH`, `HOME`, `PLAYWRIGHT_MCP_EXECUTABLE_PATH`, etc.
4. Configure SDK options: model, `maxTurns: 10000`, `bypassPermissions`, `allowDangerouslySkipPermissions: true`, `settingSources: ['user']`, adaptive thinking (Opus 4.6+/4.7/4.8), `outputFormat`, `mcpServers`
5. Stream messages via `query()` → `processMessageStream()` → `dispatchMessage()`
6. Post-stream: `isSpendingCapBehavior()` defense-in-depth check
7. Return `ClaudePromptResult`: `{ result, success, duration, turns, cost, model, structuredOutput }`

### 10.3 `ai/message-handlers.ts` — Message Dispatch

```
dispatchMessage() routes by type:

'assistant' → handleAssistantMessage()
  ├─ Structured error: SDKAssistantMessageError (billing_error, rate_limit, etc.)
  └─ Text sniffing: detectApiError(content) checks billing patterns

'system' + 'init'      → Log model/permission info
'system' + 'model_refusal_fallback' → Audit Fable→Opus routing
'tool_use'             → Log tool name + params → audit logToolStart
'tool_result'          → Log truncated result → audit logToolEnd
'result'               → Capture cost, duration, structured output
'user', 'tool_progress', 'tool_use_summary', 'auth_status' → No-op
```

### 10.4 Error Detection (3 Layers)

| Layer | Method | Detection | Outcome |
|---|---|---|---|
| 1 | `handleStructuredError()` | SDK error type (billing_error, rate_limit, etc.) | Mapped to PentestError with retryable flag |
| 2 | `detectApiError()` | Text sniffing for billing patterns | PentestError(billing, retryable=true) |
| 3 | `isSpendingCapBehavior()` | Behavioral: turns ≤ 2 && cost === 0 + billing text | PentestError(billing, retryable=true) |

### 10.5 `ai/queue-schemas.ts` — Structured Output Schemas

Each vuln class has a Zod schema for structured JSON output:

```typescript
// Common base: ID, vulnerability_type, externally_exploitable, confidence, notes
InjectionVulnerability → +source, combined_sources, path, sink_call, slot_type, sanitization_observed, concat_occurrences, verdict, mismatch_reason, witness_payload
XssVulnerability      → +source, source_detail, path, sink_function, render_context, encoding_observed, verdict, mismatch_reason, witness_payload
AuthVulnerability     → +source_endpoint, vulnerable_code_location, missing_defense, exploitation_hypothesis, suggested_exploit_technique
SsrfVulnerability     → +source_endpoint, vulnerable_parameter, vulnerable_code_location, missing_defense, exploitation_hypothesis, suggested_exploit_technique
AuthzVulnerability    → +endpoint, vulnerable_code_location, role_context, guard_evidence, side_effect, reason, minimal_witness

// Wrapped in: { vulnerabilities: Schema[] }
// Serialized to JSON Schema (draft-07) for SDK validation
```

Two variants: `OUTPUT_FORMATS_EXPLOIT` (attack-mode notes) and `OUTPUT_FORMATS_ANALYSIS` (defender-mode notes).

### 10.6 `ai/settings-writer.ts` — SDK Deny Rules

```typescript
writeUserSettingsForCodePathAvoids(config):
  // Writes ~/.claude/settings.json with permissions.deny rules
  // Blocks Read() and Edit() on matched code_path patterns
  // Deny rules fire even in bypassPermissions mode via settingSources: ['user']
```

---

## 11. MCP Collectors

### 11.1 `mcp-server/pre-recon-collector.ts` (7 one-shot tools)

| Tool | Section | Schema |
|---|---|---|
| `set_executive_summary` | §1 Security Posture | `{ text: string }` |
| `set_application_intelligence` | §2,4,5,6 | `{ architecture, data_security, attack_surface, infrastructure }` |
| `set_auth_deep_dive` | §3 | `{ authentication_mechanisms, session_management, authz_model, multi_tenancy, sso_oauth_oidc }` |
| `set_codebase_indexing` | §7 | `{ text: string }` |
| `set_critical_file_paths` | §8 | `9 groups: configuration, auth, api, data_models, deps, secrets, middleware, logging, infra` |
| `set_xss_sinks` | §9 | `{ applicable, html_body[], html_attribute[], javascript[], css[], url[] }` |
| `set_ssrf_sinks` | §10 | `{ applicable, http_clients[], raw_sockets[], url_openers[], redirect_handlers[], headless_browsers[], ... (15 categories) }` |

**Renderer**: `renderPreRecon(data)` → `pre_recon_deliverable.md` (10 sections + boilerplate)

### 11.2 `mcp-server/recon-collector.ts` (8 one-shot + 1 multi-call)

| Tool | Section | Notes |
|---|---|---|
| `set_executive_summary` | §1 | `{ text }` |
| `set_technology_stack` | §2 | `{ frontend, backend, infrastructure }` |
| `set_authentication` | §3 (3 subsections) | `{ session_flow, role_assignment, privilege_storage, role_switching_impersonation }` |
| `add_endpoints` **(multi-call)** | §4 | Append batch: `{ endpoints: [{ method, path, required_role, ... }] }`. Deduplicates (method, path) pairs |
| `set_input_vectors` | §5 | `{ url_parameters[], post_body_fields[], http_headers[], cookie_values[] }` |
| `set_network_map` | §6 (4 subsections) | `{ entities[], flows[], guards[] }` with type/zone/data classifications |
| `set_role_architecture` | §7 (4 subsections) | `{ roles[], privilege_lattice }` with privilege_level 0-10 |
| `set_authz_candidates` | §8 (3 subsections) | `{ horizontal[], vertical[], context[] }` with AUTHZ-CAND-NN IDs |
| `set_injection_sources` | §9 | `{ applicable, command_injection[], sql_injection[], ... (7 classes) }` |

**Renderer**: `renderRecon(data)` → `recon_deliverable.md` (9 sections, sorted entities/flows/roles)

### 11.3 `mcp-server/vuln-collector.ts` (3-4 tools × 5 classes, factory)

| Tool | Section | Required | Notes |
|---|---|---|---|
| `set_findings_summary` | §1-2 | **Yes** | `{ key_outcome, patterns[] }` |
| `set_strategic_intelligence` | §3 | **Yes** | Schema *varies by class* (see table below) |
| `set_safe_vectors` | §4 | No | `{ vectors: [{ subject, location, defense_mechanism, render_context? }] }` |
| `set_blind_spots` | §5 | No | Only for injection/xss/authz. `{ items: [{ heading, description }] }` |

**Per-class strategic intel schemas:**

| Class | Fields |
|---|---|
| Injection | `defensive_evasion_waf`, `error_based_potential`, `confirmed_database_technology` |
| XSS | `csp_analysis` (policy, bypassability), `cookie_security` (HttpOnly, SameSite) |
| Auth | `authentication_method` (JWT/cookie/OAuth), `session_token_details`, `password_policy` |
| SSRF | `http_client_library`, `request_architecture` (redirects), `internal_services` |
| AuthZ | `session_management_architecture`, `role_permission_model`, `resource_access_patterns`, `workflow_implementation` |

**Renderer**: `renderVulnDeliverable(class, data)` → `{class}_analysis_deliverable.md` (5 sections)

### 11.4 `mcp-server/exploit-collector.ts` (1 tool, multi-call per vuln, factory)

**Tool**: `add_exploit` — accepts discriminated union:

```typescript
// exploited variant:
{ status: 'exploited', vulnerability_id, title, vulnerable_location, overview,
  prerequisites?, severity, impact, exploitation_steps[], proof_of_impact, notes? }

// blocked variant:
{ status: 'blocked', vulnerability_id, title, vulnerable_location, overview,
  prerequisites?, confidence, current_blocker, potential_impact,
  evidence_of_vulnerability, what_we_tried, how_this_would_be_exploited[],
  expected_impact, notes? }
```

**Guardrail**: `vulnerability_id` validated against `validIds` set from queue using Zod `.refine()`. Hallucinated IDs rejected with valid ID list (preview 8, show total).

**Renderer**: `renderExploitDeliverable(class, state, idToType)` → `{class}_exploitation_evidence.md` (Exploited sorted by severity desc, Blocked sorted by confidence desc)

---

## 12. Services Layer

### 12.1 `services/container.ts` — DI Container

```typescript
class Container {
  sessionMetadata: SessionMetadata;
  config: ContainerConfig;
  agentExecution: AgentExecutionService;     // depends on ConfigLoaderService
  configLoader: ConfigLoaderService;         // standalone
  exploitationChecker: ExploitationCheckerService; // standalone
  findingsProvider: FindingsProvider;        // NoOp default
  checkpointProvider: CheckpointProvider;    // NoOp default
  reportOutputProvider: ReportOutputProvider; // NoOp default
}

// Lifecycle:
getOrCreateContainer(workflowId, sessionMetadata, config) → Container
removeContainer(workflowId)  // on workflow complete
getContainer(workflowId)     // read-only lookup

// Factory override:
setContainerFactory(fn)  // at worker startup for custom providers
```

### 12.2 `services/prompt-manager.ts`

```typescript
loadPrompt(templateKey, variables, config, testingMode, logger, promptDir):
  // 1. Load template .txt file from prompts/ directory
  // 2. Process @include() directives → load shared sub-prompts
  // 3. Interpolate {{WEB_URL}}, {{REPO_PATH}}, {{AUTH_STATE_FILE}}
  // 4. Conditional section rendering (auth blocks, rules, engagement)
  // 5. Inject PLAYWRIGHT_SESSION mapping
  // Returns: full prompt string
```

### 12.3 `services/config-loader.ts`

```typescript
class ConfigLoaderService {
  loadOptional(configPath?, configData?, configYAML?):
    // Priority: configData > configYAML > file at configPath
    // Parse YAML → validate against JSON Schema → build DistributedConfig
    // Returns: Result<DistributedConfig, PentestError>
}
```

### 12.4 `services/git-manager.ts`

```typescript
// Git operations for checkpointing:
createGitCheckpoint(deliverablesPath, agentName, attemptNumber, logger)
commitGitSuccess(deliverablesPath, agentName, logger)
rollbackGitWorkspace(deliverablesPath, reason, logger)
getGitCommitHash(deliverablesPath)
```

---

## 13. Audit & Metrics System

### 13.1 Architecture

```
AuditSession (facade)
├── MetricsTracker — session.json management (cost, duration, status, resume attempts)
├── WorkflowLogger — workflow.log (human-readable, tail-friendly)
│   └── LogStream — append-only file stream with mutex
├── AgentLogger — per-agent JSON event log (agent_start, tool_start, llm_response, agent_end)
└── SessionMutex — global mutex for concurrent parallel phase safety
```

### 13.2 `audit/audit-session.ts` — Main Facade

```typescript
class AuditSession {
  constructor(sessionMetadata)  // validates id + webUrl required
  async initialize(workflowId?)  // creates dirs, initializes MetricsTracker + WorkflowLogger
  async startAgent(agentName, promptContent, attemptNumber)
    // Save prompt (attempt 1 only), create AgentLogger, start timer, log agent_start
  async logEvent(eventType, eventData)
    // Log to agent JSON log AND workflow human-readable log
  async endAgent(agentName, result: AgentEndResult)
    // Log agent_end, close AgentLogger, log to workflow, mutex-protected metrics update
  async updateSessionStatus(status)
    // Mutex-protected session.status update
  async addResumeAttempt(workflowId, terminatedWorkflows, checkpointHash)
    // Track resume history in session.json
}
```

### 13.3 `audit/metrics-tracker.ts` — session.json

**On-disk format** (`workspaces/<sessionId>/session.json`):

```json
{
  "session": {
    "id": "uuid",
    "webUrl": "https://...",
    "status": "in-progress | completed | failed | cancelled",
    "createdAt": "ISO8601",
    "completedAt": "ISO8601",
    "originalWorkflowId": "wf-id",
    "resumeAttempts": [
      { "workflowId": "wf-2", "timestamp": "...", "resumedFromCheckpoint": "abc123" }
    ]
  },
  "metrics": {
    "total_duration_ms": 123456,
    "total_cost_usd": 1.23,
    "phases": {
      "pre-recon": { "duration_ms": 10000, "duration_percentage": 25, "cost_usd": 0.5, "agent_count": 1 },
      "recon": { ... },
      "vulnerability-analysis": { ... },
      "exploitation": { ... },
      "reporting": { ... }
    },
    "agents": {
      "pre-recon": {
        "status": "success",
        "attempts": [{ "attempt_number": 1, "duration_ms": 10000, "cost_usd": 0.5, "success": true, "timestamp": "..." }],
        "final_duration_ms": 10000,
        "total_cost_usd": 0.5,
        "model": "claude-opus-4-8",
        "checkpoint": "abc123"
      }
    }
  }
}
```

### 13.4 `audit/workflow-logger.ts` — workflow.log

**Format** (human-readable, `tail -f` friendly):

```
[2026-07-02 17:30:00] [PHASE] Starting: pre-recon
[2026-07-02 17:30:01] [pre-recon] [TOOL] set_executive_summary: ...
[2026-07-02 17:35:00] [AGENT] pre-recon: Completed (5m 0s, $0.50)
[2026-07-02 17:35:00] [PHASE] Completed: pre-recon
```

Logs: phase transitions, tool calls (with params), LLM responses, agent start/end with duration+cost.

### 13.5 `audit/utils.ts` — Path Generation

| Function | Path |
|---|---|
| `generateAuditPath(metadata)` | `<baseDir>/<sessionId>/` |
| `generateLogPath(metadata, agentName, ts, attempt)` | `<auditPath>/agents/<ts>_<agent>_attempt-<n>.log` |
| `generatePromptPath(metadata, agentName)` | `<auditPath>/prompts/<agent>.md` |
| `generateSessionJsonPath(metadata)` | `<auditPath>/session.json` |
| `generateWorkflowLogPath(metadata)` | `<auditPath>/workflow.log` |
| `authStateFile(metadata)` | `<auditPath>/auth-state.json` |
| `initializeAuditStructure(metadata)` | Creates: `auditPath/` + `agents/` + `prompts/` + `deliverables/` |

### 13.6 Concurrency Safety

`SessionMutex` from `utils/concurrency.ts` — global per-session mutex. Used during parallel phase to prevent lost updates when 5 concurrent agents write to `session.json` simultaneously. Pattern:

```typescript
const unlock = await sessionMutex.lock(sessionId);
try {
  await metricsTracker.reload();   // Read fresh from disk
  await metricsTracker.endAgent(...); // Modify
} finally {
  unlock();  // Write back to disk
}
```

---

## 14. Guardrails & Validation

### 14.1 Queue Validation Pipeline (`services/queue-validation.ts`)

5-stage pipeline per vuln class:

```
1. createPaths        → resolve deliverable + queue filenames from VULN_TYPE_CONFIG
2. checkFileExistence → both files on disk?
3. validateRules      → both exist / neither / only queue / only deliverable
4. validateQueue      → parse JSON, check vulnerabilities[] is array
5. decision           → length > 0 → shouldExploit=true
```

**`VULN_TYPE_CONFIG`**:
```typescript
injection → deliverable: 'injection_analysis_deliverable.md', queue: 'injection_exploitation_queue.json'
xss       → deliverable: 'xss_analysis_deliverable.md',       queue: 'xss_exploitation_queue.json'
auth      → deliverable: 'auth_analysis_deliverable.md',      queue: 'auth_exploitation_queue.json'
ssrf      → deliverable: 'ssrf_analysis_deliverable.md',      queue: 'ssrf_exploitation_queue.json'
authz     → deliverable: 'authz_analysis_deliverable.md',     queue: 'authz_exploitation_queue.json'
```

### 14.2 Exploit ID Guardrail (`mcp-server/exploit-collector.ts`)

```
add_exploit(vulnerability_id, ...)
  → Zod .refine() check: vulnerability_id ∈ validIds (Set<string> from queue.json)
  → REJECTED: return error with list of valid IDs (preview 8, show total)
  → ACCEPTED: record as exploited/blocked/OOS
```

### 14.3 MCP Schema Validation

- All MCP tools use Zod schemas → JSON Schema (draft-07) for SDK validation
- One-shot tools reject duplicate calls with `DuplicateError`
- `add_endpoints` deduplicates (method, path) pairs
- Missing/optional tools render as placeholders: `_[Section X: not provided — tool_name was not called]_`

### 14.4 Spending Cap Detection (3 layers)

See [Section 10.4](#104-error-detection-3-layers).

### 14.5 Git Checkpoint Safety

```
Pre-agent:  git add -A + commit  (state before agent runs)
On success: git commit            (capture checkpoint hash)
On failure: git reset --hard + git clean -fd  (rollback)
On resume:  git reset --hard + git clean -fd + delete partial deliverables
```

---

## 15. Prompt Templates

Located at `apps/worker/prompts/` — 39 files total:

### Main Prompts (15 files)

| File | Purpose |
|---|---|
| `pre-recon-code.txt` | Principal Engineer analyzes source code architecture |
| `recon.txt` | Reconnaissance Analyst maps attack surface |
| `validate-authentication.txt` | Validates login flow end-to-end |
| `report-executive.txt` | Generates executive summary report |
| `vuln-injection.txt` | Injection Analysis Specialist |
| `vuln-xss.txt` | XSS Analysis Specialist |
| `vuln-auth.txt` | Authentication Analysis Specialist |
| `vuln-ssrf.txt` | SSRF Analysis Specialist |
| `vuln-authz.txt` | Authorization Analysis Specialist |
| `exploit-injection.txt` | Injection Exploitation Specialist |
| `exploit-xss.txt` | XSS Exploitation Specialist |
| `exploit-auth.txt` | Auth Exploitation Specialist |
| `exploit-ssrf.txt` | SSRF Exploitation Specialist |
| `exploit-authz.txt` | AuthZ Exploitation Specialist |

### Shared Sub-prompts (8 files in `prompts/shared/`)

| File | Include Directive |
|---|---|
| `_rules.txt` | `{{RULES_AVOID}}` |
| `_vuln-scope.txt` | "External attacker scope" |
| `_target.txt` | URL + filesystem path |
| `_exploit-scope.txt` | Exploitation constraints + verdicts (EXPLOITED/BLOCKED/FALSE_POSITIVE) |
| `_rules-of-engagement.txt` | `<rules_of_engagement>` tags |
| `_code-path-rules.txt` | `[FILE]` and `[GLOB]` routing tags |
| `_shared-session.txt` | Playwright session restore via `playwright-cli state-load` |
| `login-instructions.txt` | Full login flow with TOTP |

### Pipeline-Testing Variants (15 files in `prompts/pipeline-testing/`)

Mirror of main prompts but with minimal context for fast iteration. Includes `shared/_filesystem.txt`.

---

## 16. Interfaces & Extension Points

### 16.1 `interfaces/checkpoint-provider.ts`

```typescript
export interface CheckpointProvider {
  shouldSkipAgent(agentName, repoPath, deliverablesSubdir): Promise<SkipDecision>;
  onAgentComplete(agentName, phase, state, context?): Promise<void>;
}
// Default: NoOpCheckpointProvider (skip nothing, persist nothing)
```

### 16.2 `interfaces/findings-provider.ts`

```typescript
export interface FindingsProvider {
  mergeFindingsIntoQueue(repoPath, vulnType, input): Promise<{ mergedCount: number }>;
}
// Default: NoOpFindingsProvider (returns { mergedCount: 0 })
```

### 16.3 `interfaces/report-output-provider.ts`

```typescript
export interface ReportOutputProvider {
  generate(input, logger): Promise<{ outputPath?: string }>;
}
// Default: NoOpReportOutputProvider (returns {})
```

### 16.4 Container Registration

```typescript
// At worker startup:
setContainerFactory((workflowId, sessionMetadata, config) =>
  new Container({
    sessionMetadata,
    config,
    findingsProvider: new MyCustomFindingsProvider(),
    checkpointProvider: new MyCustomCheckpointProvider(),
    reportOutputProvider: new MyCustomReportOutputProvider(),
  })
);
```

---

## 17. Building & Running

### 17.1 Development Setup

```bash
pnpm install                    # Install all dependencies
pnpm run build                  # Build all packages (turbo)
pnpm run check                  # TypeScript type check
pnpm biome                      # Lint + format
pnpm temporal:worker            # Start worker (requires Temporal Server)
```

### 17.2 Docker Deployment

```bash
# Build worker image
docker build -t shannon-worker .

# Start Temporal + worker
docker compose up -d

# With custom config
docker run --rm \
  -v /path/to/repo:/app/repo \
  -v /path/to/config.yaml:/app/config.yaml \
  -e ANTHROPIC_API_KEY=sk-... \
  shannon-worker
```

### 17.3 CLI Usage

```bash
# Local mode (from repo root):
./shannon start -u https://target.com -r /path/to/repo -c config.yaml

# NPX mode:
npx @keygraph/shannon start -u https://target.com -r ./repo

# With workspace (auto-resume):
./shannon start -u https://target.com -r /path/to/repo -w q1-audit

# Pipeline testing mode (minimal prompts):
./shannon start -u https://target.com -r /path/to/repo --pipeline-testing
```

---

## 18. Agent ⇄ Deliverable ⇄ Queue Matrix

| Agent | Deliverable | Queue (structured output) | MCP Server(s) | Model Tier |
|---|---|---|---|---|
| `pre-recon` | `pre_recon_deliverable.md` | — | pre-recon-collector (7 tools) | `large` (Opus) |
| `recon` | `recon_deliverable.md` | — | recon-collector (9 tools) | `medium` (Sonnet) |
| `injection-vuln` | `injection_analysis_deliverable.md` | `injection_exploitation_queue.json` | vuln-collector (4 tools) | default |
| `xss-vuln` | `xss_analysis_deliverable.md` | `xss_exploitation_queue.json` | vuln-collector (4 tools) | default |
| `auth-vuln` | `auth_analysis_deliverable.md` | `auth_exploitation_queue.json` | vuln-collector (3 tools) | default |
| `ssrf-vuln` | `ssrf_analysis_deliverable.md` | `ssrf_exploitation_queue.json` | vuln-collector (3 tools) | default |
| `authz-vuln` | `authz_analysis_deliverable.md` | `authz_exploitation_queue.json` | vuln-collector (4 tools) | default |
| `injection-exploit` | `injection_exploitation_evidence.md` | — | exploit-collector (1 tool) | default |
| `xss-exploit` | `xss_exploitation_evidence.md` | — | exploit-collector (1 tool) | default |
| `auth-exploit` | `auth_exploitation_evidence.md` | — | exploit-collector (1 tool) | default |
| `ssrf-exploit` | `ssrf_exploitation_evidence.md` | — | exploit-collector (1 tool) | default |
| `authz-exploit` | `authz_exploitation_evidence.md` | — | exploit-collector (1 tool) | default |
| `report` | `comprehensive_security_assessment_report.md` | — | — | default |
