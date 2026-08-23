import type { Tool } from "minicore";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { lspDiagnostics, lspCall, findSymbolPosition, getConfiguredExts } from "../lsp/client.ts";

const SEVERITY = ["Error", "Warn", "Info", "Hint"];

function toUri(abs: string): string {
  return pathToFileURL(abs).href;
}

async function readTarget(file: string): Promise<{ abs: string; text: string }> {
  const abs = resolvePath(process.cwd(), file);
  const text = await readFile(abs, "utf8");
  return { abs, text };
}

function formatPos(p: unknown): string {
  const r = p as { range?: { start?: { line?: number } }; uri?: string; targetUri?: string };
  const uri = r.uri ?? r.targetUri ?? "?";
  const line = r.range?.start?.line != null ? `:${(r.range.start.line ?? 0) + 1}` : "";
  return `${uri}${line}`;
}

interface PosArgs {
  file: string;
  symbol?: string;
  line?: number;
  character?: number;
}

async function resolvePosition(args: PosArgs): Promise<{ abs: string; text: string; position: { line: number; character: number } } | string> {
  if (getConfiguredExts().length === 0) return "(no LSP servers configured — add via minicode config lsp add)";
  const { abs, text } = await readTarget(args.file);
  let position: { line: number; character: number } | null = null;
  if (args.line != null) position = { line: args.line, character: args.character ?? 0 };
  else if (args.symbol) position = findSymbolPosition(text, args.symbol);
  if (!position) return `[lsp] symbol '${args.symbol}' not found in ${args.file}`;
  return { abs, text, position };
}

function formatHover(result: unknown): string {
  const c = (result as { contents?: unknown })?.contents;
  const txt =
    typeof c === "object" && c !== null && "value" in (c as Record<string, unknown>)
      ? String((c as Record<string, unknown>).value)
      : typeof c === "string"
        ? c
        : JSON.stringify(c);
  return txt.slice(0, 4_000) || "(empty hover)";
}

function posTool(name: string, method: string, describe: string, extraParams: Record<string, unknown> = {}, limit = 50): Tool {
  return {
    name,
    description: describe,
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "path file relatif cwd" },
        symbol: { type: "string", description: "nama simbol di file (alternatif line/character)" },
        line: { type: "number", description: "baris 0-based (opsional)" },
        character: { type: "number", description: "kolom 0-based (opsional)" },
      },
      required: ["file"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      try {
        const resolved = await resolvePosition(args as PosArgs);
        if (typeof resolved === "string") return resolved;
        const { abs, text, position } = resolved;
        const result = await lspCall(
          abs,
          text,
          method,
          {
            textDocument: { uri: toUri(abs) },
            position,
            ...extraParams,
          },
        );
        if (!result || (Array.isArray(result) && result.length === 0)) return "(not found)";
        if (method === "textDocument/hover") return formatHover(result);
        if (Array.isArray(result)) return result.map(formatPos).slice(0, limit).join("\n");
        return formatPos(result);
      } catch (e) {
        return `[lsp] ${(e as Error).message}`;
      }
    },
  };
}

export const lspDiagnosticsTool: Tool = {
  name: "lsp_diagnostics",
  description: "Diagnostik LSP untuk satu file (error/warning dari language server). Butuh server LSP terdaftar untuk ekstensi file.",
  parameters: {
    type: "object",
    properties: { file: { type: "string", description: "path file relatif cwd" } },
    required: ["file"],
    additionalProperties: false,
  },
  async execute({ file }, ctx) {
    ctx.signal.throwIfAborted();
    try {
      const { abs, text } = await readTarget(String(file));
      const { items } = await lspDiagnostics(abs, text);
      if (!items.length) return "(no diagnostics)";
      return items.map((d) => {
        const dd = d as { range?: { start?: { line?: number; character?: number } }; severity?: number; message?: string; source?: string };
        const sev = SEVERITY[(dd.severity ?? 1) - 1] ?? "?";
        const pos = `${(dd.range?.start?.line ?? 0) + 1}:${(dd.range?.start?.character ?? 0) + 1}`;
        return `${pos} [${sev}] ${dd.message}${dd.source ? ` (${dd.source})` : ""}`;
      }).join("\n");
    } catch (e) {
      return `[lsp] ${(e as Error).message}`;
    }
  },
};

export const lspDefinitionTool = posTool("lsp_definition", "textDocument/definition", "Lokasi definisi simbol (file + baris). Params: file + symbol atau line/character.");

export const lspReferencesTool = posTool(
  "lsp_references",
  "textDocument/references",
  "Semua referensi simbol di repo (file + baris). Params: file + symbol.",
  { context: { includeDeclaration: true } },
  100,
);

export const lspHoverTool = posTool("lsp_hover", "textDocument/hover", "Hover info / tipe data simbol. Params: file + symbol.");

export const lspSymbolsTool: Tool = {
  name: "lsp_symbols",
  description: "Outline simbol dokumen (fungsi/kelas/variabel) via LSP.",
  parameters: {
    type: "object",
    properties: { file: { type: "string", description: "path file relatif cwd" } },
    required: ["file"],
    additionalProperties: false,
  },
  async execute({ file }, ctx) {
    ctx.signal.throwIfAborted();
    try {
      const { abs, text } = await readTarget(String(file));
      const result = await lspCall(abs, text, "textDocument/documentSymbol", { textDocument: { uri: toUri(abs) } });
      if (!result || !Array.isArray(result) || result.length === 0) return "(no symbols)";
      const KIND = ["File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field", "Constructor", "Enum", "Interface", "Function", "Variable", "Constant"];
      return result.map((s) => {
        const sym = s as { name?: string; kind?: number; range?: { start?: { line?: number } } };
        const kind = KIND[sym.kind ?? 1] ?? "?";
        const line = (sym.range?.start?.line ?? 0) + 1;
        return `${line}: [${kind}] ${sym.name}`;
      }).join("\n");
    } catch (e) {
      return `[lsp] ${(e as Error).message}`;
    }
  },
};