// Deterministic test doubles: scripted provider, permission handlers, helpers.

import type {
  AgentEvent,
  Decision,
  EventBus,
  JSONSchema,
  ModelProvider,
  PermissionHandler,
  ProviderError,
  ProviderEvent,
  StreamRequest,
  Tool,
  ToolCall,
} from "../src/core/index.ts";
import { AgentError } from "../src/core/index.ts";

export type FakeStep =
  | { events: readonly ProviderEvent[] }
  | { error: ProviderError }
  | { throw: unknown }
  | { events: readonly ProviderEvent[]; error: ProviderError }
  | { events: readonly ProviderEvent[]; throw: unknown };

export class FakeProvider implements ModelProvider {
  readonly id = "fake";
  readonly models = ["fake-1"];
  readonly requests: StreamRequest[] = [];
  steps: FakeStep[];

  constructor(steps: FakeStep[] = []) {
    this.steps = steps;
  }

  stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.requests.push(request);
    const step = this.steps.shift() ?? { events: [{ type: "finish", reason: "stop" }] };
    return emitFake(step, signal);
  }
}

async function* emitFake(step: FakeStep, signal: AbortSignal): AsyncIterable<ProviderEvent> {
  if (signal.aborted) throw new AgentError("aborted", "turn aborted");
  if ("events" in step) {
    for (const event of step.events) {
      if (signal.aborted) throw new AgentError("aborted", "turn aborted");
      yield event;
    }
    if ("error" in step) throw step.error;
    if ("throw" in step) throw step.throw;
    return;
  }
  if ("error" in step) throw step.error;
  throw step.throw;
}

// -- event builders -----------------------------------------------------------

export const text = (textValue: string): ProviderEvent => ({ type: "text", text: textValue });
export const toolCall = (name: string, args: unknown, id = "call-1"): ProviderEvent => ({
  type: "tool_call",
  id,
  name,
  args,
});
export const finish = (reason: "stop" | "tool_calls" | "length" | "abort" | "error"): ProviderEvent => ({ type: "finish", reason });

// -- tools --------------------------------------------------------------------

export function tool(
  name: string,
  execute: (input: Record<string, unknown>, ctx: { signal: AbortSignal }) => unknown | Promise<unknown>,
  parameters: JSONSchema = { type: "object", additionalProperties: false },
): Tool {
  return {
    name,
    description: `tool ${name}`,
    parameters,
    execute: async (input, ctx) => execute(input as Record<string, unknown>, ctx),
  };
}

export const echoTool: Tool = tool("echo", async ({ x }) => `echo:${String(x)}`, {
  type: "object",
  properties: { x: { type: "string" } },
  required: ["x"],
  additionalProperties: false,
});

// -- permissions --------------------------------------------------------------

export const allowAll: PermissionHandler = { check: async () => "allow" };
export const denyAll: PermissionHandler = { check: async () => "deny" };

export function recordingPermission(decide: (call: ToolCall) => Decision): PermissionHandler & { calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  return {
    calls,
    async check(call) {
      calls.push(call);
      return decide(call);
    },
  };
}

// -- observability -------------------------------------------------------------

export function collectEvents(bus: EventBus): { events: AgentEvent[]; unsubscribe: () => void } {
  const events: AgentEvent[] = [];
  const unsubscribe = bus.on("*", (event) => events.push(event));
  return { events, unsubscribe };
}

export function eventTypes(bus: EventBus): string[] {
  return collectEvents(bus).events.map((event) => event.type);
}

// -- recovery ------------------------------------------------------------------

export const fastRetryRecovery = {
  onError: (_error: ProviderError, attempt: number) =>
    attempt > 2 ? ({ type: "throw" } as const) : ({ type: "retry", delayMs: 1 } as const),
  onLength: () => ({ type: "throw" } as const),
};