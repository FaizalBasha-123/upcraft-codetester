import { Duration, Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { AppProcess } from "@agenthorsy-ai/core/process"
import { Config } from "@/config/config"

export interface Hook {
  event: "PreToolUse" | "PostToolUse" | "PreStop"
  matcher?: string
  command: string
}

export interface HookResult {
  blocked: boolean
  replacement?: string
  feedback?: string
}

function detectHooks(worktree: string): Hook[] {
  const hooks: Hook[] = []
  const pkgPath = path.join(worktree, "package.json")
  if (!existsSync(pkgPath)) return hooks

  let pkg: Record<string, unknown> = {}
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
  } catch {
    return hooks
  }

  const deps = pkg.dependencies as Record<string, unknown> | undefined
  const devDeps = pkg.devDependencies as Record<string, unknown> | undefined
  const scripts = pkg.scripts as Record<string, string> | undefined

  const hasEslint = deps?.eslint || devDeps?.eslint
  const hasPrettier = deps?.prettier || devDeps?.prettier
  const hasVitest = devDeps?.vitest
  const hasJest = devDeps?.jest
  const hasTestScript = scripts?.test && !scripts.test.includes("echo")

  if (hasEslint) {
    hooks.push({
      event: "PostToolUse",
      matcher: "edit|write",
      command: "npx eslint $(git diff --name-only --diff-filter=AM 2>/dev/null | grep -E '\\.(ts|tsx|js|jsx)$') 2>&1 || exit 2",
    })
  }

  if (hasPrettier) {
    hooks.push({
      event: "PostToolUse",
      matcher: "edit|write",
      command: "npx prettier --check $(git diff --name-only --diff-filter=AM 2>/dev/null) 2>&1 || exit 2",
    })
  }

  if (hasVitest) {
    hooks.push({ event: "PreStop", command: "npx vitest run 2>&1 || exit 2" })
  } else if (hasJest || hasTestScript) {
    hooks.push({ event: "PreStop", command: "npm test 2>&1 || exit 2" })
  }

  if (existsSync(path.join(worktree, "tsconfig.json"))) {
    hooks.push({
      event: "PostToolUse",
      matcher: "edit|write",
      command: "npx tsc --noEmit 2>&1 || exit 2",
    })
  }

  return hooks
}

function loadConfiguredHooks(worktree: string): Hook[] {
  const hooksFile = path.join(worktree, ".agenthorsy", "hooks.json")
  if (!existsSync(hooksFile)) return []

  try {
    const raw = JSON.parse(readFileSync(hooksFile, "utf-8"))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (h): h is Hook =>
        typeof h === "object" &&
        h !== null &&
        typeof h.event === "string" &&
        typeof h.command === "string" &&
        ["PreToolUse", "PostToolUse", "PreStop"].includes(h.event),
    )
  } catch {
    return []
  }
}

function loadConfigHooks(config: { hooks?: Array<{ event: string; matcher?: string; command: string }> }): Hook[] {
  if (!config.hooks) return []
  return config.hooks.filter(
    (h): h is Hook =>
      typeof h.event === "string" &&
      typeof h.command === "string" &&
      ["PreToolUse", "PostToolUse", "PreStop"].includes(h.event),
  )
}

function resolveHooks(worktree: string, configHooks?: Hook[]): Hook[] {
  // Config hooks take precedence over hooks.json
  if (configHooks && configHooks.length > 0) return configHooks
  const configured = loadConfiguredHooks(worktree)
  if (configured.length > 0) return configured
  return detectHooks(worktree)
}

function matchesMatcher(toolID: string, matcher?: string): boolean {
  if (!matcher) return true
  const patterns = matcher.split("|")
  return patterns.some((p) => toolID.includes(p.trim()))
}

function runCommand(command: string, cwd: string): Effect.Effect<{ exitCode: number; stderr: string }, never, AppProcess.Service> {
  return Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const result = yield* appProcess
      .run(
        ChildProcess.make("sh", ["-c", command], {
          cwd,
          env: { ...process.env, FORCE_COLOR: "0" },
          stdout: "pipe",
          stderr: "pipe",
        }),
        { timeout: Duration.seconds(60) },
      )
      .pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, stderr: Buffer.from("hook command failed") })))
    return { exitCode: result.exitCode, stderr: result.stderr.toString("utf8") }
  })
}

function getWorktree(): Effect.Effect<string> {
  return InstanceState.context.pipe(Effect.map((ctx) => ctx.worktree))
}

function getConfigHooks(): Effect.Effect<Hook[], never, Config.Service> {
  return Effect.gen(function* () {
    const config = yield* Config.Service
    const cfg = yield* config.get()
    return loadConfigHooks(cfg)
  }).pipe(Effect.catch(() => Effect.succeed([])))
}

export function runPostToolUseHooks(toolID: string): Effect.Effect<HookResult, never, AppProcess.Service | Config.Service> {
  return Effect.gen(function* () {
    const worktree = yield* getWorktree()
    const configHooks = yield* getConfigHooks()
    const hooks = resolveHooks(worktree, configHooks)
    const matching = hooks.filter((h) => h.event === "PostToolUse" && matchesMatcher(toolID, h.matcher))

    if (matching.length === 0) return { blocked: false }

    for (const hook of matching) {
      const { exitCode, stderr } = yield* runCommand(hook.command, worktree)
      if (exitCode === 2 && stderr) {
        return { blocked: false, replacement: stderr.slice(0, 4000) }
      }
    }

    return { blocked: false }
  })
}

export function runPreStopHooks(): Effect.Effect<HookResult, never, AppProcess.Service | Config.Service> {
  return Effect.gen(function* () {
    const worktree = yield* getWorktree()
    const configHooks = yield* getConfigHooks()
    const hooks = resolveHooks(worktree, configHooks)
    const matching = hooks.filter((h) => h.event === "PreStop")

    if (matching.length === 0) return { blocked: false }

    for (const hook of matching) {
      const { exitCode, stderr } = yield* runCommand(hook.command, worktree)
      if (exitCode === 2 && stderr) {
        return {
          blocked: false,
          feedback: `PreStop hook failed. Fix these issues before completing:\n\n${stderr.slice(0, 4000)}`,
        }
      }
    }

    return { blocked: false }
  })
}
