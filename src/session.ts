import type { RecoveryAction } from "minicore/core/errors.ts"
import { ProviderError } from "minicore/core/errors.ts"
import type { Session, SessionConfig } from "minicore/core/index.ts"
import { createSession as createCoreSession } from "minicore/core/index.ts"
import { defaultRecoveryPolicy } from "minicore/core/recovery.ts"
import { LIMITS } from "./constants.ts"
import { buildSystemPrompt, minicodeEstimator } from "./policy/context.ts"
import { parallelExecutor } from "./policy/executor.ts"
import { createPermissionHandler, type PermissionMode } from "./policy/permission.ts"

// P2 cap wrapper: limit retryAfter to 30s without mutating original error
const cappedRecovery = {
  onError(error: ProviderError, attempt: number): RecoveryAction {
    if (error.retryAfterMs != null && error.retryAfterMs > LIMITS.RETRY_AFTER_MAX_MS) {
      const capped = new ProviderError(error.category, error.message, LIMITS.RETRY_AFTER_MAX_MS)
      // preserve extra fields if any
      Object.assign(capped, { cause: (error as unknown as { cause?: unknown }).cause })
      return defaultRecoveryPolicy.onError(capped, attempt)
    }
    return defaultRecoveryPolicy.onError(error, attempt)
  },
  onLength(compacted: boolean): RecoveryAction {
    return defaultRecoveryPolicy.onLength(compacted)
  },
}

export type PermissionControl = {
  setMode(m: "auto" | "readonly" | "plan" | "allow-all" | "ask" | "allowlist"): void
  getMode(): "auto" | "readonly" | "plan" | "allow-all" | "ask" | "allowlist"
}

export async function createMinicodeSession(
  opts: Partial<
    Omit<SessionConfig, "permissions" | "estimator" | "recovery" | "system" | "executor">
  > & {
    systemExtra?: string
    cwd?: string
    permissionMode?: "auto" | "readonly" | "plan" | "allow-all" | "ask" | "allowlist"
    concurrency?: number
    writeConcurrency?: number
    /** Menerima handle kontrol mode permission. Kernel tidak mengekspos
     * `config`, jadi satu-satunya cara mengubah mode saat runtime (mis.
     * Shift+Tab di TUI) adalah menangkap handler di sini. */
    onPermissions?: (control: PermissionControl) => void
  },
): Promise<Session> {
  const planHint =
    opts.permissionMode === "plan"
      ? "\n\nPLAN MODE: You are in read-only planning mode. Do NOT modify files, run bash, or use write/edit tools. Only read, search, and reason — then output a concrete implementation plan."
      : ""
  const system = await buildSystemPrompt({
    cwd: opts.cwd,
    extra: (opts.systemExtra ?? "") + planHint,
  })
  const {
    concurrency,
    writeConcurrency,
    cwd,
    permissionMode,
    systemExtra: _extra,
    provider,
    onPermissions,
    ...rest
  } = opts
  if (!provider) throw new Error("createMinicodeSession: provider is required")
  const permissions = createPermissionHandler({ mode: permissionMode ?? "auto", root: cwd })
  if (onPermissions) {
    const withMode = permissions as typeof permissions & {
      __setMode(m: PermissionMode): void
      __getMode(): PermissionMode
    }
    onPermissions({
      setMode: (m) => withMode.__setMode(m),
      getMode: () => withMode.__getMode(),
    })
  }
  return createCoreSession({
    ...rest,
    provider,
    system,
    permissions,
    estimator: minicodeEstimator,
    recovery: cappedRecovery,
    executor: parallelExecutor({
      concurrency: concurrency ?? LIMITS.EXECUTOR_CONCURRENCY,
      writeConcurrency: writeConcurrency ?? LIMITS.EXECUTOR_WRITE_CONCURRENCY,
    }),
  })
}
