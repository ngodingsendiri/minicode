import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php"]);
const MAX_FILES = 60;
const MAX_FILE_BYTES = 100_000;
const MAX_REPOMAP_CHARS = 2500;
const MAX_SYMBOLS_PER_FILE = 40;

function langFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs": return "ts";
    case ".py": return "py";
    case ".go": return "go";
    case ".rs": return "rs";
    case ".java": return "java";
    case ".c": case ".cpp": case ".h": case ".hpp": return "c";
    default: return "";
  }
}

interface LinePattern {
  re: RegExp;
  render: (m: RegExpExecArray) => string;
}

const PATTERNS: Record<string, LinePattern[]> = {
  ts: [
    { re: /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, render: (m) => `function ${m[1]}(...)` },
    { re: /^export\s+class\s+([A-Za-z_$][\w$]*)/, render: (m) => `class ${m[1]}` },
    { re: /^export\s+interface\s+([A-Za-z_$][\w$]*)/, render: (m) => `interface ${m[1]}` },
    { re: /^export\s+(type|enum)\s+([A-Za-z_$][\w$]*)/, render: (m) => `${m[1]} ${m[2]}` },
    { re: /^export\s+const\s+([A-Za-z_$][\w$]*)/, render: (m) => `const ${m[1]}` },
    { re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, render: (m) => `function ${m[1]}(...)` },
    { re: /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, render: (m) => `class ${m[1]}` },
    { re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, render: (m) => `interface ${m[1]}` },
  ],
  py: [
    { re: /^(?:async\s+)?def\s+(\w+)\s*\(/, render: (m) => `def ${m[1]}(...)` },
    { re: /^class\s+(\w+)/, render: (m) => `class ${m[1]}` },
  ],
  go: [
    { re: /^func\s+([\w*[\]].]+)\s*\(/, render: (m) => `func ${m[1]}(...)` },
    { re: /^type\s+(\w+)\s+(?:struct|interface)\b/, render: (m) => `type ${m[1]}` },
  ],
  rs: [
    { re: /^(?:pub\s+)?fn\s+(\w+)\s*\(/, render: (m) => `fn ${m[1]}(...)` },
    { re: /^(?:pub\s+)?struct\s+(\w+)/, render: (m) => `struct ${m[1]}` },
    { re: /^(?:pub\s+)?(?:enum|trait)\s+(\w+)/, render: (m) => `${m[0].includes("trait") ? "trait" : "enum"} ${m[1]}` },
    { re: /^(?:pub\s+)?impl\s+(\w+)/, render: (m) => `impl ${m[1]}` },
  ],
  java: [
    { re: /^(?:public|private|protected|static|final|abstract|\s)*\b(?:class|interface|enum)\s+(\w+)/, render: (m) => `type ${m[1]}` },
    { re: /^\s+(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\],. ]+\s+(\w+)\s*\(/, render: (m) => `method ${m[1]}(...)` },
  ],
  c: [
    { re: /^[A-Za-z_][\w\s*]*\b(\w+)\s*\([^)]*\)\s*\{/, render: (m) => `function ${m[1]}(...)` },
    { re: /^(?:struct|enum)\s+(\w+)/, render: (m) => `${m[0].startsWith("struct") ? "struct" : "enum"} ${m[1]}` },
  ],
};

// Ekstrak simbol dari konten file berdasarkan bahasa. Deterministik & cepat (regex).
export function extractSymbols(content: string, lang: string): string[] {
  const patterns = PATTERNS[lang];
  if (!patterns) return [];
  const symbols: string[] = [];
  const seen = new Set<string>();
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t || t.startsWith("//") || t.startsWith("#") || t.startsWith("/*") || t.startsWith("*")) continue;
    for (const p of patterns) {
      const m = p.re.exec(t);
      if (m) {
        const sig = p.render(m);
        const key = sig.replace(/\s+/g, " ").trim();
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push(sig);
        }
        break;
      }
    }
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
  }
  return symbols;
}

function isSourceFile(f: string): boolean {
  const dot = f.lastIndexOf(".");
  return dot !== -1 && SOURCE_EXTS.has(f.slice(dot).toLowerCase());
}

async function walkForFiles(root: string, rel: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  const dir = rel ? join(root, rel) : root;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (out.length >= limit) break;
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walkForFiles(root, r, out, limit);
    else if (isSourceFile(e.name)) out.push(r);
  }
}

// Daftar file sumber (git ls-files dulu → fallback walk).
async function listSourceFiles(cwd: string, limit: number): Promise<string[]> {
  try {
    const res = (await execAsync("git ls-files", { cwd, timeout: 3000, encoding: "utf8" } as never)) as unknown as { stdout: string; stderr: string };
    const files = res.stdout.split("\n").map((f) => f.replace(/\\/g, "/")).filter(Boolean);
    if (files.length) return files.filter(isSourceFile).slice(0, limit);
  } catch {}
  const out: string[] = [];
  await walkForFiles(cwd, "", out, limit);
  return out;
}

function cachePath(cwd: string): string {
  return resolve(cwd, ".minicode", "repomap.json");
}

// Bangun repo-map compact dari daftar file.
export async function buildRepoMap(cwd: string = process.cwd(), opts: { limit?: number } = {}): Promise<string> {
  const limit = opts.limit ?? MAX_FILES;
  const files = await listSourceFiles(cwd, limit);
  const parts: string[] = [];
  for (const f of files) {
    const abs = resolve(cwd, f);
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const content = readFileSync(abs, "utf8");
      const symbols = extractSymbols(content, langFor(f));
      if (symbols.length) parts.push(`${f}:\n${symbols.map((s) => `  ${s}`).join("\n")}`);
    } catch {}
  }
  return parts.join("\n").slice(0, MAX_REPOMAP_CHARS);
}

// Signature cepat: path+mtime+size dari file terpilih — buat deteksi perubahan.
function signature(files: string[], cwd: string): string {
  let sig = "";
  for (const f of files.slice(0, 80)) {
    try {
      const st = statSync(resolve(cwd, f));
      sig += `${f}:${st.mtimeMs}:${st.size};`;
    } catch {}
  }
  return sig;
}

// Load repo-map, pakai cache di .minicode/repomap.json bila file tak berubah.
export async function loadRepoMap(cwd: string = process.cwd()): Promise<string> {
  const files = await listSourceFiles(cwd, MAX_FILES);
  if (files.length === 0) return "";
  const sig = signature(files, cwd);
  const cp = cachePath(cwd);
  try {
    const cached = JSON.parse(readFileSync(cp, "utf8")) as { sig?: string; map?: string };
    if (cached.sig === sig && typeof cached.map === "string") return cached.map;
  } catch {}
  const map = await buildRepoMap(cwd, { limit: MAX_FILES });
  try {
    mkdirSync(resolve(cwd, ".minicode"), { recursive: true });
    writeFileSync(cp, JSON.stringify({ sig, map }));
  } catch {}
  return map;
}