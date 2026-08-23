import { createSession as createCoreSession } from "../../minicore/src/core/index.ts";
import type { Session, SessionConfig } from "../../minicore/src/core/index.ts";
import { createPermissionHandler } from "./policy/permission.ts";
import { minicodeEstimator, buildSystemPrompt } from "./policy/context.ts";
import { defaultRecoveryPolicy } from "../../minicore/src/core/recovery.ts";
import { parallelExecutor } from "./policy/executor.ts";
import { ProviderError } from "../../minicore/src/core/errors.ts";
import type { RecoveryAction } from "../../minicore/src/core/errors.ts";

// P2 cap wrapper: limit retryAfter to 30s without mutating original error
const cappedRecovery = {
  onError(error: ProviderError, attempt: number): RecoveryAction {
    if (error.retryAfterMs != null && error.retryAfterMs > 30_000) {
      const capped = new ProviderError(error.category, error.message, 30_000);
      // preserve extra fields if any
      Object.assign(capped, { cause: (error as unknown as { cause?: unknown }).cause });
      return defaultRecoveryPolicy.onError(capped, attempt);
    }
    return defaultRecoveryPolicy.onError(error, attempt);
  },
  onLength(compacted: boolean): RecoveryAction {
    return defaultRecoveryPolicy.onLength(compacted);
  },
};

export async function createMinicodeSession(
  opts: Omit<SessionConfig, "permissions" | "estimator" | "recovery" | "system" | "executor"> & {
    systemExtra?: string;
    cwd?: string;
    permissionMode?: "auto" | "readonly" | "allow-all" | "ask";
    concurrency?: number;
    writeConcurrency?: number;
  },
): Promise<Session> {
  const system = await buildSystemPrompt({ cwd: opts.cwd, extra: opts.systemExtra });
  const { concurrency, writeConcurrency, cwd, permissionMode, systemExtra: _extra, ...rest } = opts as typeof opts & {
    concurrency?: number;
    writeConcurrency?: number;
  };
  return createCoreSession({
    ...rest,
    system,
    permissions: createPermissionHandler({ mode: permissionMode ?? "auto", root: cwd }),
    estimator: minicodeEstimator,
    recovery: cappedRecovery,
    executor: parallelExecutor({
      concurrency: concurrency ?? 8,
      writeConcurrency: writeConcurrency ?? 2,
    }),
  });
}
