// Permission boundary. The kernel commits to consulting this handler before
// every tool execution; it never enforces its own policy.

import type { ToolCall } from "./types.ts";
import type { ExecutorDeps } from "./executor.ts";

/**
 * Only "deny" blocks execution. A handler that needs interactive approval
 * (e.g. a CLI prompt) is expected to block until it resolves the decision
 * internally and then return "allow" or "deny".
 */
export type Decision = "allow" | "deny";

export interface PermissionHandler {
  check(call: ToolCall, deps: ExecutorDeps): Promise<Decision>;
}