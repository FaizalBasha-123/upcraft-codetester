# Oh-My-OpenAgent System Design Reference

> Deep architecture analysis of oh-my-openagent (v4.15.1) — a plugin that extends
> OpenCode/Codex CLI with 11 agents, 3-tier MCP, 5-tier hooks, Team Mode, skills,
> and category-based delegation. Use this to build your own orchestration system.
>
> Last generated: 2026-07-12 | Source: oh-my-openagent @ 25bb0d5ac

---

## 1. Philosophy & Core Problems Solved

### The Fundamental Problem

LLMs (even the best ones like Claude Opus 4.7, GPT-5.5) have severe limitations:

1. **Limited context windows** — You can't fit an entire codebase in one prompt.
2. **Single-model weakness** — One model excels at architecture, another at fast search, another at vision.
3. **Token cost** — Using an expensive reasoning model for a simple grep is wasteful.
4. **Context bleed** — A long session degrades in quality as irrelevant context accumulates.
5. **No inherent coordination** — A single model can't parallelize work across domains.

### Key Innovations

| Innovation | Problem Solved |
|---|---|
| **Category-based routing** | Delegate by work type, not agent name. System routes to right model. |
| **Model fallback chains** | If Claude is down, fall back to GPT → Kimi → GLM automatically. |
| **Tool restrictions per agent** | Oracle can't write; Momus can't edit. Prevents accidental side-effects. |
| **Hashline edit** | Content-hash on Read, validated on Edit. Prevents stale-context writes. |
| **5-tier hooks** | Session, ToolGuard, Transform, Continuation, Skill — layered interception. |
| **Team Mode** | Parallel agents with shared mailbox/tasklist. Like Slack for AI agents. |
| **Skill system** | Reusable Markdown instructions loaded dynamically. Plugins for agent prompts. |
| **Three-tier MCP** | Built-in + .mcp.json + skill-embedded. Composable tool servers. |
| **Multi-Harness Architecture**| Isolates pure agent logic (Core) from specific IDE APIs (Adapters) to run everywhere. |
| **IntentGate Detection** | Fast regex-based intent interception on first message (bypasses LLM routing). |
| **Boulder State Tracking**| Persistent work-tracking state machine outside the LLM context window. |
| **OpenClaw Gateway** | Bidirectional daemon bridging agents to Discord/Telegram/HTTP/Shell. |

---

## 2. The 11 Agents — Layer By Layer

### Layer 0: The Orchestrator — Sisyphus

**Role**: Main orchestrator, planner, delegator
**Mode**: primary | **Model**: claude-opus-4-7 max | **Fallback**: kimi-k2.6 → k2p5 → kimi-k2.5 → gpt-5.5 medium → glm-5 → big-pickle
**Denied**: none | **Team**: eligible

**Problem solved**: LLMs dive into implementation without planning. Sisyphus plans, explores, delegates — never codes directly.

- Uses `task()` to delegate by category to Sisyphus-Junior
- Fires 3-4 parallel Explore agents to map codebase before acting
- Calls Oracle for hard architecture decisions or after 2+ failed fixes
- Calls Momus to review plans before execution
- Model-specific prompts per family (Claude vs GPT vs Kimi)

**Real-world**: "Add dark mode" → Sisyphus fires 3 Explores (find theme files, CSS vars, patterns) + Librarian (best practices) → creates plan with dependency graph → delegates via task(quick) for CSS, task(deep) for provider → verifies completion.

---

### Layer 1: The Deep Worker — Hephaestus

**Role**: Autonomous deep worker, end-to-end implementation
**Mode**: primary | **Model**: gpt-5.5 medium (GPT-only!) | **Fallback**: single-entry openai/gh-copilot/opencode/vercel
**Denied**: none | **Team**: conditional (needs teammate:allow override)

**Problem solved**: Some tasks need one agent to work autonomously without returning control at every step.

- GPT-only — designed for GPT-5.3 Codex/5.4/5.5
- Thorough exploration before writing code
- Inspired by AmpCode deep mode

---

### Layer 2: The Strategic Advisor — Oracle

**Role**: Read-only consultation, high-IQ reasoning
**Mode**: subagent | **Model**: gpt-5.5 high | **Fallback**: gemini-3.1-pro high → claude-opus-4-7 max → glm-5.1
**Denied**: write, edit, apply_patch, task, call_omo_agent | **Team**: hard-reject

**Problem solved**: Deep reasoning is expensive. Oracle is called on-demand for hard problems only.

- Never writes code. Pure consultation.
- Decision framework: pragmatic minimalism, one clear path, bias toward simplicity
- Strict verbosity: bottom line 2-3 sentences, plan ≤7 steps, effort estimated
- Called after 2+ failed fix attempts

---

### Layer 3: The Codebase Researcher — Explore

**Role**: Contextual grep, codebase search specialist
**Mode**: subagent | **Model**: gpt-5.4-mini-fast (cheapest) | **Fallback**: qwen3.5-plus → minimax-... → gpt-5.4-nano
**Denied**: write, edit, apply_patch, task, call_omo_agent, some LSP | **Team**: hard-reject

**Problem solved**: Sisyphus needs answers, not tools. Explore gives structured results cheaply and in parallel.

- Launches 3+ search tools simultaneously
- Returns structured `<results>` with absolute paths, answer, next steps
- Designed for background execution

---

### Layer 4: The External Researcher — Librarian

**Role**: Open-source code understanding, documentation search
**Mode**: subagent | **Model**: gpt-5.4-mini-fast | **Fallback**: qwen3.5-plus → minimax-... → gpt-5.4-nano
**Denied**: write, edit, apply_patch, task, call_omo_agent | **Team**: hard-reject

**Problem solved**: Developers ask "How do I use library X?" or "Show me how Y implements Z".

- Classifies requests: Conceptual → docs, Implementation → gh clone, Context → issues/PRs, Comprehensive → all
- Always produces github.com permalinks
- Documentation Discovery phase (sitemap → targeted pages)

---

### Layer 5: The Pre-Planning Analyst — Metis

**Role**: Pre-planning consultant, ambiguity detection
**Mode**: subagent | **Model**: claude-sonnet-4-6 | **Temp**: 0.3
**Fallback**: claude-opus-4-7 max → gpt-5.5 high → glm-5.1 → k2p5
**Denied**: write, edit, apply_patch | **Team**: hard-reject

**Problem solved**: LLMs produce confident wrong plans from vague requests. Metis detects ambiguity before planning.

- Classifies intent: Refactoring / Build / Mid-sized / Collaborative / Architecture / Research
- Explores before asking (fires explore/librarian automatically)
- Detects AI-slop: scope inflation, premature abstraction, over-validation, doc bloat
- Produces agent-executable QA directives (concrete commands, not "user manually tests")

---

### Layer 6: The Plan Reviewer — Momus

**Role**: Work plan reviewer, blocker detector
**Mode**: subagent | **Model**: gpt-5.5 xhigh | **Fallback**: claude-opus-4-7 max → gemini-3.1-pro high → glm-5.1
**Denied**: write, edit, apply_patch | **Team**: hard-reject

**Problem solved**: LLM plans contain blockers. Momus catches them before implementation.

- Checks: reference validity, executability, critical blockers, QA scenario executability
- "Approve by default. Reject only for true blockers. Max 3 issues. No design opinions."

---

### Layer 7: The Todo Orchestrator — Atlas

**Role**: Todo-list-driven execution orchestrator
**Mode**: primary | **Model**: claude-sonnet-4-6 | **Fallback**: kimi-k2.6 → gpt-5.5 medium → minimax-m3 → minimax-m2.7
**Denied**: task, call_omo_agent | **Team**: eligible

**Problem solved**: Plans need execution. Atlas executes every task in a todo list without delegation.

- Cannot delegate — does work directly with tools
- "Complete ALL tasks until fully done"
- Verifies each task before marking complete
- Sisyphus plans, Atlas executes

---

### Layer 8: The Planner — Prometheus

**Role**: Planning consultant, creates work plans
**Mode**: primary | **Model**: claude-opus-4-7 max | **Fallback**: gpt-5.5 high → glm-5.1 → gemini-3.1-pro
**Denied**: .md-only writes (hook-enforced) | **Team**: hard-reject

**Problem solved**: Planning is a separate concern from execution.

- Special-cased — not in agentSources like the other 10
- Only writes to `.omo/plans/*.md`
- First action: load `shared/ulw-plan` skill
- "do X" means "plan X" — execution is a separate session
- Cannot implement by proxy (no subagent edits product code)

---

### Layer 9: The Vision Specialist — Multimodal-Looker

**Role**: Image/PDF/document analysis
**Mode**: subagent | **Model**: gpt-5.5 medium (vision) | **Fallback**: kimi-k2.6 → glm-4.6v → gpt-5-nano
**Denied**: ALL tools except read | **Team**: hard-reject

**Problem solved**: Main agent shouldn't waste expensive context on vision. Dedicated cheap vision agent.

- Only has `read` tool
- Returns extracted information, saving context tokens

---

### Layer 10: The Worker Bee — Sisyphus-Junior

**Role**: Category-spawned executor
**Mode**: subagent | **Model**: claude-sonnet-4-6 | **Fallback**: kimi-k2.6 → gpt-5.5 medium → minimax-m3 → minimax-m2.7 → big-pickle
**Denied**: task (no sub-delegation) | **Has**: call_omo_agent | **Team**: eligible

**Problem solved**: Delegation needs an executor that doesn't create infinite delegation loops.

- Cannot delegate further (no `task()` tool)
- Can still research (has `call_omo_agent` for explore/librarian)
- Category-aware: gets model + prompt based on delegation category
- High max tokens (64000)

---

### Agent Hierarchy

```
                    SISYPHUS (orchestrator)
                   /        |          \
          task() delegate   skill()    call_omo_agent()
                 |                          |
          Sisyphus-Junior           Oracle / Explore / Librarian
            (executor)              (subagents)
                 |
          Hephaestus (deep work)
          Atlas (todo exec)

          PROMETHEUS (planner, separate)
          METIS → (pre-plan analysis)
          MOMUS → (post-plan review)
          MULTIMODAL-LOOKER (vision)
```

---

## 3. Communication Patterns

1. **Delegate-task**: `task(category, prompt)` → Sisyphus-Junior. Category determines model/temp.
2. **Named agent**: `call_omo_agent(agent, prompt)` → Direct to specific subagent.
3. **Skill**: `skill(name)` → Loads instruction bundle into current context.
4. **Team mode**: `team_create` → mailbox + tasklist-based async messaging.

---

## 4. Multi-Harness Architecture (Core vs Adapters)

To support OpenCode, Codex, and Senpi simultaneously without duplicating agent logic, the system is strictly layered:

1. **Core Packages**: Pure TypeScript logic (models, prompts, tools, rules, state, telemetry, MCP client) that knows *nothing* about the host IDE.
2. **MCP Packages**: Standalone Node/Bun servers providing IDE-agnostic capabilities (LSP Daemon, Git Bash).
3. **Adapters (Harnesses)**: Thin translation layers (`omo-opencode`, `omo-codex`, `omo-senpi`) that wire the Core packages into the specific plugin API of the host.

This pattern is crucial for building AI orchestration that outlives a single editor framework.

---

## 5. Tool Catalog

### Always-On (12)

grep, glob, session_list, session_read, session_search, session_info, background_output, background_cancel, task(delegate), call_omo_agent, skill, skill_mcp

### Conditional (+19)

look_at (looker enabled), interactive_bash (tmux), edit/hashline (hashline_edit), task_create/get/list/update (task_system), monitor_start/stop/list/output (monitor)

### Team Mode (+12, when enabled)

team_create, team_delete, team_shutdown_request, team_approve_shutdown, team_reject_shutdown, team_send_message, team_task_create/get/list/update, team_status, team_list

### LSP MCP (+8, always via built-in)

lsp_status, lsp_diagnostics, lsp_goto_definition, lsp_find_references, lsp_symbols, lsp_prepare_rename, lsp_rename, lsp_install_decision

### Base Harness (from OpenCode)

Bash, Read, Write, Edit, Glob, Grep, Task, Question, WebSearch, WebFetch

---

## 6. Categories (8)

quick(gpt-5.4-mini), deep(gpt-5.5 med), ultrabrain(gpt-5.5 xhigh), writing(k2p5), artistry(gemini-3.1-pro high), visual-engineering(gemini-3.1-pro high), unspecified-low(claude-sonnet-4-6), unspecified-high(claude-opus-4-7 max)

---

## 7. Tool Access Matrix

| Tool | Sisy | Heph | Prom | Atlas | Orac | Lib | Expl | ML | Metis | Mom | SJ |
|------|:----:|:----:|:----:|:-----:|:----:|:---:|:----:|:--:|:-----:|:---:|:--:|
| Bash | Y | Y | Y | Y | N | N | N | N | N | N | Y |
| Read | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Write | Y | Y | N.md | Y | N | N | N | N | N | N | Y |
| Edit | Y | Y | N.md | Y | N | N | N | N | N | N | Y |
| Grep | Y | Y | Y | Y | Y | Y | Y | N | Y | Y | Y |
| Glob | Y | Y | Y | Y | Y | Y | Y | N | Y | Y | Y |
| LSP* | Y | Y | Y | Y | Y | Y | N | N | Y | Y | Y |
| sess* | Y | Y | Y | Y | Y | Y | Y | N | Y | Y | Y |
| bg* | Y | Y | Y | Y | N | N | N | N | N | N | Y |
| task(d) | Y | Y | Y | N | N | N | N | N | N | N | N |
| call_omo| N | N | N | N | N | N | N | N | N | N | Y |
| skill | Y | Y | Y | Y | Y | Y | Y | N | Y | Y | Y |
| sk_mcp | Y | Y | Y | Y | Y | Y | Y | N | Y | Y | Y |
| look_at | Y | Y | N | Y | N | N | N | N | N | N | Y |
| int_bash| Y | Y | N | Y | N | N | N | N | N | N | Y |
| tsk_sys | Y | Y | N | Y | N | N | N | N | N | N | N |
| mon* | Y | Y | N | Y | N | N | N | N | N | N | Y |
| team* | Y | W | N | Y | N | N | N | N | N | N | Y |
| Qstn | Y | Y | Y | Y | N | N | N | N | N | N | N |

Y=Yes N=No W=Conditional N.md=Only .md files; SJ=Sisyphus-Junior

---

## 7. Key Patterns to Copy

1. **Planner ≠ Executor** — Separate strategist/executor/deep-worker with different models
2. **Read-only advisors** — Enforce permissions: inform vs execute
3. **Category abstraction** — Route by work type, not agent name
4. **Quality gates** — Metis pre-plan, Momus post-plan
5. **Cheap parallel exploration** — Fast agents first, expensive synthesis second
6. **Model-specific prompts** — Different prompts per model family
7. **Hashline/stale-context protection** — Content hash on read, validated on write
8. **Tiered hooks** — Clear layering for plugin system
9. **File-based agent communication** — Filesystem as async bus (simple, inspectable, crash-recoverable)
10. **Fallback chains** — No single provider dependency
11. **Multi-Harness Separation** — Isolate core agent logic from host IDE APIs.
12. **Zero-shot Intent Gates** — Use fast regex/heuristics on the first prompt before engaging an expensive model to route work.
13. **External State Machine (Boulder)** — Keep long-running task state outside the LLM context to survive crashes and compactions.

---

## 9. Glossary

| Term | Definition |
|------|------------|
| Agent | Configured LLM instance (role, model, tools, prompt) |
| Category | Abstract work type determining model selection |
| Delegate-task | task() routing to Sisyphus-Junior by category |
| Skill | Reusable Markdown instruction bundle |
| MCP | Model Context Protocol for tools/resources |
| Hook | Interception point in agent lifecycle |
| Team Mode | Parallel agents with async mailbox |
| Hashline | LINE#ID hashes on Read/Edit |
| Fallback chain | Prioritized alternative models |

---

> **Note**: Independent architectural analysis of oh-my-openagent commit 25bb0d5ac.
> No code copied. For building similar systems without license concerns.
