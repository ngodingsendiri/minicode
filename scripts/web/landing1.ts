// Potongan konten landing (bagian 1): hero + install + demo terminal.
// Konten diringkas dari docs/ agar akurat, bukan karangan. Versi dibaca
// dari package.json saat build (tidak hardcode angka yang bisa basi).
export function landingHero(version: string): string {
  const install =
    "git clone https://github.com/startupmini/minicode &&amp; cd minicode\nbun install &amp;&amp; bun link"
  const installRaw =
    "git clone https://github.com/startupmini/minicode && cd minicode\nbun install && bun link"
  return `<div class="wrap"><section class="hero">
<span class="eyebrow"><span class="material-symbols-outlined" style="font-size:16px">terminal</span>v${version} · MIT · zero-dep · bun ≥ 1.0</span>
<h1>Coding agent CLI yang tinggal di shell kamu.</h1>
<p class="lead">Minicode berjalan di atas kernel MiniCore yang dibekukan: tools FS, bash, git, memory RAG, MCP, LSP, dan checkpoint shadow-git. Output mengalir ke scrollback — tanpa alternate screen, tanpa panel.</p>
<div class="cta">
<a class="btn btn-p" href="/docs/"><span class="material-symbols-outlined">menu_book</span>Baca dokumentasi</a>
<a class="btn btn-s" href="/blog/"><span class="material-symbols-outlined">article</span>Blog AI</a>
<a class="btn btn-s" href="https://github.com/startupmini/minicode"><span class="material-symbols-outlined">code</span>GitHub</a>
</div>
<div class="term" id="install"><div class="term-cap"><span class="material-symbols-outlined" style="font-size:15px">terminal</span>install<span class="sp"><button class="copybtn" data-copy="${installRaw}" aria-label="Salin perintah install"><span class="material-symbols-outlined">content_copy</span></button></span></div><pre><code>${install}</code></pre></div>
<div class="term"><div class="term-cap"><span class="material-symbols-outlined" style="font-size:15px">play_arrow</span>minicode “buat http server” --verbose</div><pre><code>$ minicode “buat http server hello world di server.ts” --verbose
  ✓ write_file server.ts
  ✓ bash bun run server.ts
Hello world di http://localhost:3000 — receipt di atas permanen di scrollback,
progres transient tidak pernah bocor ke output.</code></pre></div>
</section></div>`
}

export function landingWhy(): string {
  const items: Array<[string, string, string]> = [
    [
      "scroll",
      "Scrollback, bukan redraw",
      "Teks model dan receipt menempel di riwayat shell. Bisa di-pipe, di-grep, di-copy.",
    ],
    [
      "tune",
      "Pipe-safe",
      "Non-TTY: nol cursor-control, nol spinner. Warna mati saat di-redirect; NO_COLOR menang.",
    ],
    [
      "traffic",
      "Satu arbitrator transient",
      "Garis status dan spinner lewat satu ownership di statusline.ts — tidak tumpang tindih.",
    ],
    [
      "block",
      "Tanpa alternate screen",
      "Picker dan manager transient dan menghapus diri. Tidak ada chrome permanen.",
    ],
  ]
  const cards = items
    .map(
      ([ic, h, p]) =>
        `<div class="feat"><span class="material-symbols-outlined">${ic}</span><h3>${h}</h3><p>${p}</p></div>`,
    )
    .join("")
  return `<section class="band band-soft"><div class="wrap"><div class="sec-kick">Kenapa shell-native</div><h2>Bukan TUI. Sengaja.</h2><p class="sec-sub">Kontrak terminal Minicode dibekukan di <code>docs/TERMINAL_CONTRACT.md</code> — 12 invariant dijaga test peta proteksi.</p><div class="grid grid-4">${cards}</div></div></section>`
}
