// Universal message & call records. No imports; the kernel's leaf type layer.
// These are the records that flow between the runtime, its context store, and
// provider adapters — never wire-specific shapes.

/** A single content part: plain text or inline image bytes. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: Uint8Array; mime: string };

/** Message content: a plain string or an ordered list of parts. */
export type Content = string | readonly ContentPart[];

/** A model-requested tool invocation, dispatched by the executor. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

/**
 * The observation produced by executing a tool call. `isError: true` marks a
 * failed execution (unknown tool, denied permission, invalid args, or a thrown
 * tool error); the loop treats it as a normal observation, never a kernel
 * failure.
 */
export interface ToolResult {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly name: string;
  readonly content: unknown;
  readonly isError?: boolean;
}

/** A user turn. The first message of every run is appended by the kernel. */
export interface UserMessage {
  readonly role: "user";
  readonly content: Content;
}

/** A model turn: text output, optionally carrying tool calls to dispatch. */
export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: Content;
  readonly toolCalls?: readonly ToolCall[];
  /** DeepSeek-style thinking content (reasoning), di-preservasi untuk multi-turn. */
  readonly reasoning?: string;
}

/** Everything the context store can hold, discriminated by `role`. */
export type Message = UserMessage | AssistantMessage | ToolResult;
