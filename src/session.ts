import { createSession as createCoreSession } from "../../minicore/src/core/index.ts";
import type { Session, SessionConfig } from "../../minicore/src/core/index.ts";
import { createPermissionHandler } from "./policy/permission.ts";
import { minicodeEstimator, buildSystemPrompt } from "./policy/context.ts";
import { defaultRecoveryPolicy } from "../../minicore/src/core/recovery.ts";
import type { ProviderError, RecoveryAction } from "../../minicore/src/core/errors.ts";

// P2 cap wrapper: limit retryAfter to 30s
const cappedRecovery = {
  onError(error: ProviderError, attempt: number): RecoveryAction {
    if (error.retryAfterMs != null && error.retryAfterMs > 30_000) {
      (error as unknown as { retryAfterMs: number }).retryAfterMs = 30_000;
    }
    return defaultRecoveryPolicy.onError(error, attempt);
  },
  onLength(compacted: boolean): RecoveryAction {
    return defaultRecoveryPolicy.onLength(compacted);
  },
};

export async function createMinicodeSession(opts: Omit<SessionConfig, "permissions" | "estimator" | "recovery" | "system"> & { systemExtra?: string; cwd?: string; permissionMode?: "auto" | "readonly" | "allow-all" }): Promise<Session> {
  const system = await buildSystemPrompt({ cwd: opts.cwd, extra: opts.systemExtra });
  return createCoreSession({
    ...opts,
    system,
    permissions: createPermissionHandler({ mode: opts.permissionMode ?? "auto", root: opts.cwd }),
    estimator: minicodeEstimator,
    recovery: cappedRecovery,
  });
}
