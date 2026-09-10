// Potongan konten landing (bagian 2): fitur + provider + flags + faq.
export function landingFeatures(): string {
  const feats: Array<[string, string, string, string, string]> = [
    [
      "build",
      "37 tool",
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
      "14 gateway + OAuth",
      "OpenAI-compat, Anthropic, router fallback, login device-code tanpa API key.",
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
        `<div class="feat"><span class="material-symbols-outlined">${ic}</span><h3>${h}</h3><p>${p}</p><a class="more" href="${href}">${more} →</a></div>`,
    )
    .join("")
  return `<section class="band" id="fitur"><div class="wrap"><div class="sec-kick">Fitur</div><h2>Satu biner kecil, enam subsistem.</h2><p class="sec-sub">Tiap klaim merujuk ke file sumber agar bisa diverifikasi dengan read_file.</p><div class="grid grid-3">${cards}</div></div></section>`
}

export function landingProviders(): string {
  const chips = [
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
    .map((c) => `<span class="chip">${c}</span>`)
    .join("")
  return `<section class="band band-soft"><div class="wrap"><div class="sec-kick">Provider</div><h2>14 gateway, tanpa bocor endpoint.</h2><p class="sec-sub">Picker <code>Gateway &gt;</code> hanya menampilkan label — tanpa URL. Login OAuth device-code tersedia tanpa API key. Detail di <a href="/docs/config-providers.html">Config &amp; Provider</a>.</p><div class="chips">${chips}</div></div></section>`
}

export function landingFlags(): string {
  const rows: Array<[string, string]> = [
    ["<code>--verify</code>", "Auto-verify baseline-first + self-heal maks 3 siklus."],
    [
      "<code>--sandbox docker|os|none</code>",
      "Isolasi bash; default OS-native otomatis bila tersedia.",
    ],
    ["<code>--budget 0.50</code>", "Batas biaya sesi; warn 80%, tolak prompt baru bila lewat."],
    ["<code>--budget-strict</code>", "Fail-closed: cost tak dikenal dianggap over budget."],
    ["<code>--ask / --plan</code>", "Human-in-loop per tool, atau mode rencana read-only."],
    ["<code>--tool-scope explore</code>", "Subset read-only 12 tool untuk eksplorasi aman."],
    ["<code>--provider &lt;id&gt;</code>", "Paksa provider tanpa ubah config."],
    ["<code>--model a::b</code>", "Override model sekali jalan, lintas provider."],
    [
      "<code>--resume &lt;id&gt;</code>",
      "Lanjutkan sesi dengan full history + validasi workspace.",
    ],
    ["<code>--cwd &lt;path&gt;</code>", "Workspace root untuk tool file dan jail."],
  ]
  const tr = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")
  return `<section class="band"><div class="wrap"><div class="sec-kick">CLI</div><h2>Flags yang paling dipakai.</h2><p class="sec-sub">Tabel penuh, mode REPL, dan environment variables ada di <a href="/docs/cli.html">CLI — Mode &amp; Flags</a>.</p><table class="flat"><thead><tr><th>Flag</th><th>Fungsi</th></tr></thead><tbody>${tr}</tbody></table></div></section>`
}

export function landingFaq(): string {
  const faqs: Array<[string, string]> = [
    [
      "Butuh API key?",
      "Tidak harus. <code>minicode auth login</code> memakai OAuth device-code — kode singkat, setujui di browser. API key tetap didukung untuk 14 gateway.",
    ],
    [
      "Jalan di Windows?",
      "Ya, via Bun. Sandbox OS-native (bubblewrap/seatbelt) tidak ada di Windows — default turun ke allowlist dengan alasan dicetak sekali, atau pakai <code>--sandbox docker</code>.",
    ],
    [
      "Biaya tampil N/A?",
      "Model belum ada di tabel harga. Jalankan <code>minicode pricing sync</code> lalu <code>pricing show &lt;model&gt;</code>. Semua angka estimasi.",
    ],
    [
      "/undo memulihkan apa?",
      "Perubahan file turn terakhir (yang dilacak git). File ber-.gitignore tidak ikut — disengaja agar node_modules tak ikut snapshot.",
    ],
    [
      "MCP localhost ditolak?",
      "Itu penjaga SSRF, bukan bug. Tambahkan server dengan <code>--allow-private</code> saat <code>config mcp add</code>.",
    ],
    [
      "Butuh Node.js?",
      "Tidak — wajib Bun ≥ 1.0 karena <code>bun:sqlite</code> dipakai langsung. Tidak jalan di Node.js.",
    ],
  ]
  const items = faqs
    .map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`)
    .join("")
  return `<section class="band band-soft"><div class="wrap"><div class="sec-kick">FAQ</div><h2>Yang sering ditanya.</h2><div class="faq">${items}</div><div class="cta"><a class="btn btn-p" href="/docs/troubleshooting.html"><span class="material-symbols-outlined">healing</span>Troubleshooting lengkap</a><a class="btn btn-s" href="https://github.com/startupmini/minicode/issues"><span class="material-symbols-outlined">bug_report</span>Lapor bug</a></div></div></section>`
}
