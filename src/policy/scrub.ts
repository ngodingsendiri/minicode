// Secret scrubber — redact credential/token/private key sebelum konten sampai ke LLM.
// Dipanggil dari tool read_file, bash, grep, dan memory (best-effort, defense-in-depth).

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / DeepSeek / Anthropic api keys
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
  /\b(dsk-[A-Za-z0-9_-]{20,})\b/g,
  // GitHub tokens
  /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  // AWS access key
  /\b(AKIA[0-9A-Z]{16})\b/g,
  // Private key PEM blocks — lazy dot-all, aman karena terbatas ukuran file (2MB)
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  // Generic api_key / secret / token = <value>
  /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi,
  // Bearer token header
  /\bbearer\s+[A-Za-z0-9._-]{20,}\b/gi,
  // Slack tokens
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  // JWT — any base64url payload
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
];

// Redact secrets dalam teks. Ganti match dengan [REDACTED].
export function scrubSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

// Khusus untuk per baris (grep): redact per baris.
export function scrubLine(line: string): string {
  return scrubSecrets(line);
}