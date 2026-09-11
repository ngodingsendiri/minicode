// Potongan konten landing (bagian 2): fitur + provider + flags + faq.
export function landingFeatures(): string {
  const feats = [
    [
      "build",
      "Tools (37)",
      "FS, bash, git, web, memory, sub-agen, MCP, LSP. Dijail realpath, atomic, secret-scrub.",
      "/docs/tools.html",
      "Referensi tools",
    ],
    [
      "shield",
      "Policy & sandbox",
      "6 permission mode, bash-guard ternormalisasi, sandbox OS-native otomatis.",
      "/docs/policy-sandbox.html",
      "Policy & sandbox",
    ],
    [
      "hub",
      "Provider (14)",
      "OpenAI-compat, Anthropic, router fallback, OAuth device-code untuk provider yang mendukung.",
      "/docs/config-providers.html",
      "Config & provider",
    ],
    [
      "memory",
      "Memory & sessions",
      "RAG hybrid, checkpoint shadow-git O(delta), /undo dan /redo per turn.",
      "/docs/memory-sessions.html",
      "Memory & sessions",
    ],
    [
      "extension",
      "MCP & LSP",
      "Client stdio + Streamable HTTP, plus mcp serve. LSP diagnostics otomatis.",
      "/docs/mcp-lsp.html",
      "MCP & LSP",
    ],
    [
      "verified",
      "Verify & benchmark",
      "--verify baseline-first + self-heal 3 siklus, harness audit 60 cek.",
      "/docs/verify-benchmark.html",
      "Verify & benchmark",
    ],
  ]
  const cards = feats
    .map(
      ([ic, h, p, href, more]) =>
        `<div class="feat"><h3><span class="material-symbols-outlined">${ic}</span>${h}</h3><p>${p}</p><a class="more" href="${href}">${more} →</a></div>`,
    )
    .join("")
  return `<section id="fitur"><h2>37 tool.</h2><p class="sub">Tiap klaim merujuk ke file sumber untuk diverifikasi.</p><div class="feat-list">${cards}</div></section>`
}

export function landingProviders(): string {
  const names = [
    "openai",
    "anthropic",
    "openrouter",
    "deepseek",
    "opencode-zen",
    "google",
    "ollama",
    "qwen",
    "groq",
    "together",
    "fireworks",
    "mistral",
    "cohere",
    "generic",
  ]
  return `<section><h2>14 gateway.</h2><p class="sub">Picker <code>Gateway &gt;</code> menampilkan label tanpa URL. Detail di <a href="/docs/config-providers.html">Config &amp; Provider</a>.</p><div class="prov-line">${names.join(" · ")}</div></section>`
}

export function landingFlags(): string {
  const rows = [
    ["<code>--verify</code>", "Auto-verify baseline-first + self-heal maks 3 siklus."],
    ["<code>--sandbox docker|os|none</code>", "Isolasi bash; default OS-native bila tersedia."],
    ["<code>--budget 0.50</code>", "Batas biaya sesi; warn 80%, tolak bila lewat."],
    ["<code>--budget-strict</code>", "Fail-closed: cost tak dikenal dianggap over budget."],
    ["<code>--ask / --plan</code>", "Human-in-loop per tool, atau mode read-only."],
    ["<code>--tool-scope explore</code>", "Subset read-only 12 tool."],
    ["<code>--provider &lt;id&gt;</code>", "Paksa provider tanpa ubah config."],
    ["<code>--model a::b</code>", "Override model sekali jalan."],
    ["<code>--resume &lt;id&gt;</code>", "Lanjutkan sesi + validasi workspace."],
    ["<code>--cwd &lt;path&gt;</code>", "Root untuk tool file dan jail."],
  ]
  const tr = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")
  return `<section><h2>Flags utama.</h2><p class="sub">Tabel penuh di <a href="/docs/cli.html">CLI — Mode &amp; Flags</a>.</p><table class="tbl"><thead><tr><th>Flag</th><th>Fungsi</th></tr></thead><tbody>${tr}</tbody></table></section>`
}

export function landingFaq(): string {
  const faqs = [
    [
      "Butuh API key?",
      "Tergantung provider. Yang mendukung OAuth (mis. Qwen): <code>minicode auth login qwen</code> memakai device-code, tanpa API key. Provider lain tetap memakai API key — detail di Config &amp; Provider.",
    ],
    [
      "Jalan di Windows?",
      "Ya, via Bun. Isolasi OS-native tidak ada di Windows — default turun ke allowlist, atau <code>--sandbox docker</code>.",
    ],
    [
      "Biaya tampil N/A?",
      "<code>minicode pricing sync</code> lalu <code>pricing show &lt;model&gt;</code>.",
    ],
    ["/undo memulihkan apa?", "Perubahan file turn terakhir yang dilacak git."],
    [
      "MCP localhost ditolak?",
      "Anti-SSRF. Usulkan <code>--allow-private</code> saat <code>config mcp add</code>.",
    ],
    ["Butuh Node.js?", "Tidak. Wajib Bun ≥ 1.0 karena <code>bun:sqlite</code>."],
  ]
  const items = faqs
    .map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`)
    .join("")
  return `<section><h2>FAQ</h2><div class="faq">${items}</div><div class="cta"><a class="btn btn-s" href="/docs/troubleshooting.html">Troubleshooting</a></div></section>`
}
