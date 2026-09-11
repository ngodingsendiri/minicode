// Potongan konten landing (bagian 1): hero + install + demo terminal.
// Konten diringkas dan diprofesional: judul pendek, isi singkat.
export function landingHero(version: string): string {
  const install =
    "git clone https://github.com/startupmini/minicode &&amp; cd minicode\nbun install &amp;&amp; bun link"
  const installRaw =
    "git clone https://github.com/startupmini/minicode && cd minicode\nbun install && bun link"
  return `<section class="hero">
<div class="kicker">v${version} · MIT · zero-dep</div>
<h1>Coding agent CLI shell-native.</h1>
<p class="lead">Dibangun di atas kernel MiniCore yang beku: tools file, bash, git, MCP, LSP, memory RAG, dan checkpoint shadow-git. Output append-only ke scrollback — tanpa alternate screen.</p>
<div class="cta">
<a class="btn btn-p" href="/docs/">Baca dokumentasi</a>
<a class="btn btn-s" href="https://github.com/startupmini/minicode">GitHub</a>
</div>
<div class="term" id="install"><div class="term-cap"><span class="material-symbols-outlined" style="font-size:13px">terminal</span>instalasi<span class="sp"><button class="copybtn" data-copy="${installRaw}" aria-label="Salin perintah instalasi"><span class="material-symbols-outlined">content_copy</span></button></span></div><pre><code>${install}</code></pre></div>
<div class="term"><div class="term-cap"><span class="material-symbols-outlined" style="font-size:13px">forward</span>demo — minicode &ldquo;buat http server&rdquo; --verbose</div><pre><code>$ minicode &ldquo;buat http server di server.ts&rdquo; --verbose
  write_file server.ts
  bash bun run server.ts
Hello world di http://localhost:3000 — receipt permanen di scrollback,
progres transient tidak bocor ke output.</code></pre></div>
<figure class="shot" role="img" aria-label="Contoh sesi Minicode: tulis file, jalankan server, tampil ringkasan biaya">
<svg viewBox="0 0 640 188" width="100%" role="presentation" aria-hidden="true"><rect width="640" height="188" rx="12" fill="#161618"/><text x="20" y="34" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#e6e8ee">$ minicode &#8220;buat http server di server.ts&#8221;</text><text x="20" y="62" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#7fd1a3">  ✓ write_file server.ts (214 chars)</text><text x="20" y="90" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#7fd1a3">  ✓ $ bun run server.ts</text><text x="36" y="114" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#8b8f98">Hello world di http://localhost:3000</text><text x="20" y="142" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#8b8f98">  128 token · $0.0004 · 2 langkah · 4s</text><text x="20" y="170" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#e6e8ee">Server jalan. Mau saya tambah route /health?</text></svg>
<figcaption>Transkrip asli yang dirender: receipt tiap tool, biaya sesi, tanpa layar khusus.</figcaption>
</figure>
</section>`
}

export function landingWhy(): string {
  const items = [
    [
      "scroll",
      "Scrollback",
      "Teks model dan receipt menempel di riwayat shell. Bisa di-pipe, di-grep, di-copy.",
    ],
    ["tune", "Pipe-safe", "Non-TTY deterministik, tanpa cursor-control. NO_COLOR menang."],
    [
      "traffic",
      "Transient arbitrator",
      "Garis status lewat satu ownership di statusline.ts — tanpa tumpang tindih.",
    ],
    ["block", "Tanpa alternate screen", "Picker dan manager transient dan menghapus diri."],
  ]
  const cards = items
    .map(
      ([ic, h, p]) =>
        `<div class="feat"><h3><span class="material-symbols-outlined">${ic}</span>${h}</h3><p>${p}</p></div>`,
    )
    .join("")
  return `<section><h2>Bukan TUI. Sengaja.</h2><p class="sub">Kontrak terminal dibekukan di <code>docs/TERMINAL_CONTRACT.md</code> — 12 invariant diuji test peta proteksi.</p><div class="feat-list">${cards}</div></section>`
}
