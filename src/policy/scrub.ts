// Secret scrubber — redact credential/token/private key sebelum konten sampai ke LLM.
// Dipanggil dari tool read_file, bash, grep, dan memory (best-effort, defense-in-depth).

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / DeepSeek / Anthropic api keys
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
  /\b(dsk-[A-Za-z0-9_-]{20,})\b/g,
  // Generic OpenAI-compatible (DeepSeek may use similar)
  /\b(AIza[A-Za-z0-9_-]{35,})\b/g,
  // GitHub tokens (all variants)
  /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  // AWS access key
  /\b(AKIA[0-9A-Z]{16})\b/g,
  // Private key PEM blocks — lazy dot-all, aman karena terbatas ukuran file (2MB)
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  // Generic api_key / secret / token = <value> — whitelist test/example/mock
  /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/gi,
  // Database connection strings with password
  /\b(?:postgresql|postgres|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
  // Bearer token header
  /\bbearer\s+[A-Za-z0-9._-]{20,}\b/gi,
  // Slack tokens
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  // NPM tokens
  /\b(npm_[A-Za-z0-9]{36,})\b/g,
  // JWT — any base64url payload
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
]

// Redact secrets dalam teks. Ganti match dengan [REDACTED].
// Whitelist: bila value mengandung test/example/mock → jangan redact (hindari false positive).
export function scrubSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      if (/test|example|mock/i.test(m)) return m
      return "[REDACTED]"
    })
  }
  return out
}

// Khusus untuk per baris (grep): redact per baris.
export function scrubLine(line: string): string {
  return scrubSecrets(line)
}

// Env vars yang namanya cocok pola kredensial di-strip sebelum spawn proses
// (bash / docker / MCP server / LSP server) — kurangi permukaan exfiltration.
export const SECRET_ENV_RE =
  /(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|DEEPSEEK|ANTHROPIC|OPENAI|AGENT_[A-Z_]*KEY|DATABASE_URL|ENCRYPTION)/i

export function stripSecretsEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_ENV_RE.test(k)) continue
    out[k] = v
  }
  return out
}

// Satu pintu env utk semua spawn (docker/mcp/lsp/bash): merge base+extra lalu
// strip kredensial dari HASIL AKHIR — extra tidak bisa me-reintroduce secret
// dan base tak pernah lolos tanpa filter.
export function sanitizeSpawnEnv(
  base: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): Record<string, string> {
  const merged: NodeJS.ProcessEnv = { ...base, ...(extra ?? {}) }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(stripSecretsEnv(merged))) {
    if (v !== undefined) out[k] = v
  }
  return out
}
