// Sanitasi sekuens ANSI dari sumber tidak terpercaya (teks model, hasil tool,
// isi berkas).
//
// Renderer sengaja MEMPERTAHANKAN warna — itulah kenapa diff card hijau/merah
// dan markdown bold bekerja. Tapi mempertahankan semua sekuens berarti model
// bisa mengirim:
//   ESC[2J ESC[H        bersihkan layar & pindahkan kursor
//   ESC[?1049h/l        masuk/keluar alternate screen (merusak TUI)
//   ESC]0;judul BEL     ubah judul jendela terminal
//   ESC[999B            geser kursor keluar area yang dihitung renderer
//   ESC[?25l            sembunyikan kursor secara permanen
// Terverifikasi: teks model `aman\x1b[2J\x1b[H\x1b[?1049hJAHAT` benar-benar
// sampai ke terminal utuh.
//
// Kebijakan: HANYA SGR (`ESC[…m`) yang dipertahankan — itu satu-satunya yang
// dibutuhkan untuk warna dan atribut teks. Semua sekuens lain dibuang, termasuk
// OSC, DCS, dan CSI non-SGR. Karakter kontrol C0 selain tab dibuang juga
// (BEL membunyikan bel terminal, BS/CR memindahkan kursor mundur).

import { escapeLength } from "./width.ts"

/** Apakah sekuens di posisi `i` adalah SGR (pewarnaan) yang boleh lewat? */
function isSgr(s: string, i: number, len: number): boolean {
  if (s[i + 1] !== "[") return false
  // SGR berakhir dengan 'm' dan parameternya hanya digit/;/: (bukan '?', '<', dll).
  if (s[i + len - 1] !== "m") return false
  for (let k = i + 2; k < i + len - 1; k++) {
    const ch = s[k]!
    if (!(ch >= "0" && ch <= "9") && ch !== ";" && ch !== ":") return false
  }
  return true
}

/**
 * Buang semua sekuens kontrol kecuali SGR. Teks tampak tidak berubah.
 *
 * Dipakai pada SEMUA teks yang berasal dari luar: `provider:text`, isi hasil
 * tool, dan konten berkas yang ditampilkan.
 */
export function sanitizeAnsi(s: string): string {
  let out = ""
  let i = 0
  while (i < s.length) {
    const ch = s[i]!
    if (ch === "\x1b") {
      const len = escapeLength(s, i)
      if (len > 0) {
        if (isSgr(s, i, len)) out += s.slice(i, i + len)
        i += len
        continue
      }
      // ESC tunggal tanpa sekuens yang dikenali: buang.
      i += 1
      continue
    }
    // Kontrol C0: tab & newline dipertahankan (pemanggil yang memecah baris),
    // sisanya dibuang. CR khususnya berbahaya — ia menimpa baris yang sudah
    // digambar.
    const code = ch.charCodeAt(0)
    if (code < 0x20 && ch !== "\t" && ch !== "\n") {
      i += 1
      continue
    }
    if (code === 0x7f) {
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * Versi satu-baris: newline juga dibuang (jadi spasi).
 * Untuk tempat yang menggambar tepat satu baris — judul, label, sel tabel.
 */
export function sanitizeAnsiLine(s: string): string {
  return sanitizeAnsi(s).replace(/\n/g, " ")
}
