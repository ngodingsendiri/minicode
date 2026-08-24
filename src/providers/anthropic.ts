import { ProviderError } from "../../../minicore/src/core/errors.ts";
import type { ModelProvider, ProviderEvent, StreamRequest } from "../../../minicore/src/core/provider.ts";
import type { ToolSchema } from "../../../minicore/src/core/tool.ts";
import type { Content, Message } from "../../../minicore/src/core/types.ts";

export interface AnthropicConfig {
  id?: string;
  apiKey: string;
  baseUrl?: string; // default https://api.anthropic.com
  models: readonly string[];
  defaultModel?: string;
  maxTokens?: number;
  enablePromptCaching?: boolean;
}

export function createAnthropicProvider(config: AnthropicConfig): ModelProvider {
  // Normalisasi baseUrl: bila sudah berakhir /v1, jangan dobel (/v1/v1/messages).
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1$/, "");
  const endpoint = `${baseUrl}/v1/messages`;
  const enableCache = config.enablePromptCaching !== false;

  return {
    id: config.id ?? "anthropic",
    models: config.models,
    async *stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      // System prompt with optional ephemeral cache control for 90% cost savings on long runs
      const systemPayload = request.system
        ? enableCache
          ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
          : request.system
        : undefined;

      const toolsPayload = request.tools?.length
        ? toAnthropicTools(request.tools, enableCache)
        : undefined;

      const body = JSON.stringify({
        model: request.model ?? config.defaultModel ?? config.models[0],
        max_tokens: config.maxTokens ?? 4096,
        system: systemPayload,
        messages: toAnthropicMessages(request.messages),
        tools: toolsPayload,
        stream: true,
      });

      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        accept: "text/event-stream",
      };

      let response: Response;
      try {
        response = await fetch(endpoint, { method: "POST", headers, body, signal });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        throw new ProviderError("network", (e as Error).message);
      }
      if (!response.ok) {
        const txt = await response.text().catch(() => "");
        throw toAnthropicError(response.status, txt, response.headers);
      }
      if (!response.body) throw new ProviderError("network", "empty response body");

      // buffer for tool inputs across deltas — per-stream (was global, now isolated)
      const pendingTools = new Map<number, { id: string; name: string; args: string }>();

      // Anthropic SSE: event: ...\ndata: {...}
      let currentEvent = "";
      for await (const chunk of sseAnthropic(response.body, signal)) {
        if (chunk.event) currentEvent = chunk.event;
        const data = chunk.data;
        if (!data) continue;
        // handle different event types
        if (currentEvent === "content_block_delta") {
          const delta = (data as any).delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            yield { type: "text", text: delta.text };
          }
        } else if (currentEvent === "message_delta") {
          const d = (data as any).delta;
          const stop = d?.stop_reason;
          if (stop) {
            if (stop === "tool_use") yield { type: "finish", reason: "tool_calls" };
            else if (stop === "max_tokens") yield { type: "finish", reason: "length" };
            else yield { type: "finish", reason: "stop" };
          }
          // Anthropic also sends usage in message_delta
          const usage = (data as any).usage ?? d?.usage;
          if (usage && (usage.input_tokens != null || usage.output_tokens != null)) {
            yield {
              type: "extension",
              kind: "usage",
              data: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheReadTokens: usage.cache_read_input_tokens,
                cacheWriteTokens: usage.cache_creation_input_tokens,
                cacheIncluded: true, // Anthropic: input_tokens sudah termasuk cache
              },
            };
          }
        } else if ((data as any).type === "message_start") {
          const usage = (data as any).message?.usage;
          if (usage) {
            yield {
              type: "extension",
              kind: "usage",
              data: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheReadTokens: usage.cache_read_input_tokens,
                cacheWriteTokens: usage.cache_creation_input_tokens,
                cacheIncluded: true,
              },
            };
          }
        }
        // content_block_start for tool_use
        if ((data as any).type === "content_block_start") {
          const block = (data as any).content_block;
          if (block?.type === "tool_use") {
            // store initial tool id/name
            pendingTools.set((data as any).index ?? 0, { id: block.id, name: block.name, args: "" });
          }
        }
        if ((data as any).type === "content_block_delta") {
          const d = (data as any).delta;
          if (d?.type === "input_json_delta") {
            const idx = (data as any).index ?? 0;
            const p = pendingTools.get(idx);
            if (p) p.args += d.partial_json ?? "";
          }
        }
        if ((data as any).type === "content_block_stop") {
          const idx = (data as any).index ?? 0;
          const p = pendingTools.get(idx);
          if (p) {
            let args: unknown = p.args;
            try {
              args = p.args ? JSON.parse(p.args) : {};
            } catch {
              args = { raw: p.args };
            }
            yield { type: "tool_call", id: p.id, name: p.name, args };
            pendingTools.delete(idx);
          }
        }
      }
    },
  };
}

function toAnthropicMessages(messages: readonly Message[]): unknown[] {
  const out: unknown[] = [];
  let toolGroup: { type: "tool_result"; tool_use_id: string; content: string }[] | null = null;
  const flushToolGroup = () => {
    if (toolGroup) {
      out.push({ role: "user", content: toolGroup });
      toolGroup = null;
    }
  };

  for (const m of messages) {
    if (m.role === "user") {
      flushToolGroup();
      out.push({ role: "user", content: toContent(m.content) });
    } else if (m.role === "assistant") {
      flushToolGroup();
      const content: unknown[] = [];
      if (typeof m.content === "string" && m.content) content.push({ type: "text", text: m.content });
      else if (Array.isArray(m.content)) for (const p of m.content) if (p.type === "text") content.push({ type: "text", text: p.text });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      }
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] });
    } else {
      const c = m as unknown as { toolCallId: string; content: unknown };
      const text = typeof c.content === "string" ? c.content : c.content instanceof Uint8Array ? Buffer.from(c.content).toString("base64") : JSON.stringify(c.content);
      toolGroup ??= [];
      toolGroup.push({ type: "tool_result", tool_use_id: c.toolCallId, content: text });
    }
  }
  flushToolGroup();
  return out;
}

function toContent(content: Content): unknown {
  if (typeof content === "string") return content;
  return (content as readonly { type: string; text?: string; data?: Uint8Array; mime?: string }[]).map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mime, data: Buffer.from(p.data as Uint8Array).toString("base64") } },
  );
}

function toAnthropicTools(tools: readonly ToolSchema[], enableCache: boolean = true): unknown[] {
  return tools.map((t, idx) => {
    const isLast = idx === tools.length - 1;
    return {
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
      ...(enableCache && isLast ? { cache_control: { type: "ephemeral" } } : {}),
    };
  });
}

function toAnthropicError(status: number, body: string, headers: Headers): ProviderError {
  const detail = body.slice(0, 500);
  const retryAfter = headers.get("retry-after");
  if (status === 429) {
    const ms = retryAfter ? Number(retryAfter) * 1000 : undefined;
    return new ProviderError("rate_limit", `rate limited (${status}): ${detail}`, Number.isFinite(ms) ? Math.min(ms!, 30_000) : undefined);
  }
  if (status === 401 || status === 403) return new ProviderError("auth", `auth failed (${status}): ${detail}`);
  if (status === 400 || status === 422) {
    const isCtx = body.toLowerCase().includes("maximum context") || body.toLowerCase().includes("prompt is too long");
    return new ProviderError(isCtx ? "context_length_exceeded" : "invalid_request", `${status}: ${detail}`);
  }
  if (status >= 500) return new ProviderError("server", `server error (${status}): ${detail}`);
  return new ProviderError("unknown", `${status}: ${detail}`);
}

async function* sseAnthropic(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let evt = "";
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("event:")) evt = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload) {
            try {
              const data = JSON.parse(payload);
              yield { event: evt, data };
            } catch {}
          }
        } else if (line === "") {
          evt = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
