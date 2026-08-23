import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { allTools } from "../tools/index.ts";
import type { Tool, ToolContext } from "minicore";

export interface McpServeOptions {
  allowAll?: boolean;
  allTools?: boolean;
  root?: string;
}

// tool internal minicode — tidak relevan/berbahaya jika dipanggil dari agent eksternal
// write_memory/forget_memory juga di-exclude biar AI luar tidak polusi vector.db global
const INTERNAL_TOOLS = new Set(["delegate_task", "mcp_call", "mcp_list", "write_memory", "forget_memory"]);

const SERVER_INFO = { name: "minicode", version: "0.1.0" };
const PROTOCOL_VERSION = "2026-07-28";

interface JsonRpcMsg {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

function send(msg: JsonRpcMsg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id: string | number, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: string | number | null | undefined, code: number, message: string) {
  if (id === undefined) return; // notification → no response
  send({ jsonrpc: "2.0", id, error: { code, message } }); // null id valid utk parse error
}

const CODE_METHOD_NOT_FOUND = -32601;
const CODE_INVALID_PARAMS = -32602;
const CODE_INTERNAL = -32603;

export function selectTools(opts: McpServeOptions): Tool[] {
  const base = opts.allTools ? allTools : allTools.filter((t) => !INTERNAL_TOOLS.has(t.name));
  const seen = new Set<string>();
  return base.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

async function invokeTool(tool: Tool, args: Record<string, unknown>, opts: McpServeOptions, signal: AbortSignal): Promise<{ content: { type: string; text: string }[]; isError: boolean }> {
  // permission check — sandbox tetap aktif walau dipanggil dari luar
  if (!opts.allowAll) {
    const { createPermissionHandler } = await import("../policy/permission.ts");
    const perms = createPermissionHandler({ mode: "auto", root: opts.root });
    const decision = await perms.check({ id: randomUUID(), name: tool.name, args }, {} as never);
    if (decision !== "allow") {
      return { content: [{ type: "text", text: `[denied] ${tool.name} blocked by minicode permission policy` }], isError: true };
    }
  }

  const ctx: ToolContext = {
    signal,
    state: { history: [], turnCount: 0, stepCount: 0 },
    emit: () => {},
  };
  const out = await tool.execute(args ?? {}, ctx);
  const text = typeof out === "string" ? out : out instanceof Uint8Array ? "(binary)" : JSON.stringify(out);
  return { content: [{ type: "text", text: text.slice(0, 100_000) }], isError: false };
}

export async function serveMcp(opts: McpServeOptions = {}): Promise<void> {
  const tools = selectTools(opts);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const shutdown = new AbortController();

  process.stderr.write(`[mcp-server] ready — ${tools.length} tools (${opts.allTools ? "all" : "curated"}${opts.allowAll ? ", allow-all" : ""})\n`);

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcMsg;
    try {
      msg = JSON.parse(line);
    } catch {
      replyError(undefined, -32700, "parse error");
      return;
    }

    void handle(msg).catch((e) => {
      if (msg.id !== undefined && msg.id !== null) replyError(msg.id, CODE_INTERNAL, String((e as Error).message ?? e));
    });
  });

  async function handle(msg: JsonRpcMsg): Promise<void> {
    const method = msg.method ?? "";
    // per JSON-RPC: pesan tanpa id = notification → JANGAN dibalas apa pun
    if (msg.id === undefined || msg.id === null) {
      if (!method.startsWith("notifications/") && method !== "initialized") {
        process.stderr.write(`[mcp-server] ignored id-less non-notification: ${method}\n`);
      }
      return;
    }
    switch (method) {
      case "server/discover":
        reply(msg.id!, {
          supportedVersions: [PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;

      case "initialize":
        reply(msg.id!, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;

      case "initialized":
      case "notifications/initialized":
        return; // notification, no response

      case "ping":
        reply(msg.id!, {});
        return;

      case "tools/list":
        reply(msg.id!, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
        });
        return;

      case "tools/call": {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const name = params.name ?? "";
        const tool = byName.get(name);
        if (!tool) {
          replyError(msg.id, CODE_INVALID_PARAMS, `unknown tool: ${name}`);
          return;
        }
        try {
          const result = await invokeTool(tool, params.arguments ?? {}, opts, shutdown.signal);
          reply(msg.id!, result);
        } catch (e) {
          reply(msg.id!, { content: [{ type: "text", text: `[error] ${(e as Error).message}` }], isError: true });
        }
        return;
      }

      default:
        if (method.startsWith("notifications/")) return;
        replyError(msg.id, CODE_METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  // stdin close → shutdown bersih
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.once(sig, () => {
        shutdown.abort();
        resolve();
      });
    }
  });
  rl.close();
}
