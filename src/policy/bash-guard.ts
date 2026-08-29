// Analisis perintah shell untuk keputusan permission.
//
// Kenapa modul terpisah? Denylist regex lama diterapkan ke string MENTAH,
// sehingga trivially dilewati oleh hal-hal yang shell anggap setara:
//
//   cat .e""nv          → shell membaca .env, regex melihat `.e""nv`
//   X=.env; cat $X      → shell membaca .env, regex tak pernah melihat ".env"
//   p=python3; $p -c 1  → interpreter jalan, regex tak melihat "python3 -c"
//   node --eval "1"     → sama dengan -e, tapi hanya `-e` yang di-regex
//
// Pendekatan di sini: NORMALISASI dulu (buang quote pemisah kata, substitusi
// assignment variabel sederhana), lalu periksa. Ini menutup seluruh kelas
// bypass, bukan satu-satu polanya.
//
// Batasan yang harus jujur: ini tetap analisis statis atas bahasa yang
// Turing-complete. Command substitution dinamis (`$(curl ...)`), aritmetika,
// dan indirection berlapis tak bisa diselesaikan tanpa mengeksekusi. Untuk
// isolasi sungguhan tetap perlu sandbox OS/container — modul ini menaikkan
// biaya serangan, bukan menghilangkannya.

export interface BashVerdict {
  /** true = tolak */
  denied: boolean
  /** alasan singkat untuk pesan ke model/user */
  reason?: string
}

// ── Normalisasi ──

/**
 * Buang quote yang dipakai untuk memecah kata tanpa mengubah arti bagi shell.
 * `.e""nv` → `.env`, `pyt"h"on3` → `python3`, `'.env'` → `.env`.
 *
 * Kita tidak mencoba meniru quoting shell sepenuhnya; tujuannya membuat
 * bentuk-terpecah dan bentuk-utuh menghasilkan string pemeriksaan yang sama.
 * Diekspor untuk test.
 */
export function stripQuotes(cmd: string): string {
  return cmd.replace(/["']/g, "")
}

/**
 * Substitusi assignment variabel sederhana dalam satu perintah.
 * `X=.env; cat $X` → `X=.env; cat .env`
 * `p=python3 && $p -c 1` → `p=python3 && python3 -c 1`
 *
 * Hanya nilai literal tanpa spasi/ekspansi yang disubstitusi — cukup untuk
 * menutup indirection yang dipakai untuk lolos filter, tanpa berpura-pura
 * mengevaluasi shell. Assignment di-scan ulang tiap lintasan agar rantai
 * (`a=.env; b=$a; cat $b`) juga terselesaikan. Diekspor untuk test.
 */
export function inlineSimpleVars(cmd: string): string {
  const ASSIGN = /(?:^|[;&|]\s*|\s)([A-Za-z_][A-Za-z0-9_]*)=([^\s;&|"'`$()]+)/g
  let out = cmd
  for (let pass = 0; pass < 3; pass++) {
    // scan ulang: substitusi lintasan sebelumnya bisa memunculkan
    // assignment literal baru (b=$a → b=.env)
    const vars = new Map<string, string>()
    ASSIGN.lastIndex = 0
    let m: RegExpExecArray | null = ASSIGN.exec(out)
    while (m !== null) {
      vars.set(m[1]!, m[2]!)
      m = ASSIGN.exec(out)
    }
    if (vars.size === 0) break
    let changed = false
    for (const [name, value] of vars) {
      const ref = new RegExp(`\\$\\{${name}\\}|\\$${name}\\b`, "g")
      const next = out.replace(ref, value)
      if (next !== out) {
        out = next
        changed = true
      }
    }
    if (!changed) break
  }
  return out
}

/**
 * Buang wrapper perintah yang tidak mengubah apa yang dijalankan.
 *
 * `command env`, `nice env`, `time env`, `exec env` semuanya menjalankan `env`,
 * tapi wrapper-nya menggeser posisi kata sehingga pola yang ter-anchor ke awal
 * perintah (mis. deteksi env-dump) tidak lagi cocok. Ditemukan oleh
 * experiments/extreme-bash-fuzz.ts: `command env` lolos sementara `env` ditolak.
 *
 * Wrapper dibuang berulang karena bisa berlapis (`time nice env`).
 * Diekspor untuk test.
 */
export function stripCommandWrappers(cmd: string): string {
  const WRAPPER =
    /(^|[;&|]\s*)(?:command|exec|builtin|eval|nice(?:\s+-n\s*-?\d+)?|nohup|time|timeout\s+[\d.]+[smhd]?|stdbuf(?:\s+-\S+)*|env(?=\s+[A-Za-z_][A-Za-z0-9_]*=)|setsid|ionice(?:\s+-\S+)*|xargs(?:\s+-\S+)*|sudo(?:\s+-\S+)*|doas)\s+/gi
  let out = cmd
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(WRAPPER, "$1")
    if (next === out) break
    out = next
  }
  return out
}

/** Bentuk kanonik untuk pemeriksaan: quote dibuang + variabel disubstitusi. */
export function normalizeCommand(cmd: string): string {
  return stripCommandWrappers(inlineSimpleVars(stripQuotes(cmd)))
}

// ── Aturan ──

/** Path/berkas kredensial, dicek pada bentuk ternormalisasi. */
const SENSITIVE_TARGET =
  /(?:^|[\s/\\=@"'([:])(?:\.env(?:\.[\w.-]+)?|\.git-credentials|\.npmrc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|\.pem|\.p12|\.pfx|shadow|master\.key)\b/i

/** Direktori kredensial: ~/.ssh, $HOME/.aws, /etc/shadow, dst. */
const SENSITIVE_DIR = /(?:~|\$HOME|\$\{HOME\}|\/etc|\/root|\/proc\/self)[/\\](?:\.?[\w.-]+)/i

/** Perintah yang membaca/menyalin isi berkas. */
const READERS =
  /\b(?:cat|bat|less|more|head|tail|nl|od|xxd|strings|type|Get-Content|cp|copy|mv|move|scp|rsync|tar|zip|gzip|base64|openssl|awk|sed|grep|egrep|fgrep|rg|cut|sort|uniq|tee|dd|install)\b/i

/** Dump environment — `printenv` sudah lama diblok, sisanya belum. */
const ENV_DUMP =
  /(?:^|[;&|]\s*)(?:printenv|env|set|export\s+-p|declare\s+-[xp]|compgen\s+-v)\s*(?:$|[;&|]|\|)/i

/** Referensi eksplisit ke variabel env yang berbau kredensial. */
const ENV_SECRET_REF =
  /\$\{?[A-Z_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|ACCESS_?KEY)[A-Z_]*\}?/

/** Flag upload berkas pada klien HTTP — jalur exfiltrasi paling langsung. */
const UPLOAD_FLAG =
  /\b(?:curl|wget|http|httpie|nc|ncat|socat)\b[^\n]*(?:-F\s*\S*=@|--form\s*\S*=@|-d\s*@|--data(?:-binary|-raw)?\s*@|-T\s+|--upload-file|--post-file=|-b\s*@)/i

/** Interpreter dijalankan dengan kode inline (semua bentuk flag). */
const INLINE_INTERPRETER =
  /\b(?:python|python2|python3|pypy|sh|bash|dash|zsh|ksh|node|deno|bun|perl|ruby|php|Rscript)\b\s+(?:-\w*\s+)*(?:-c|-e|-E|--eval|--print|-p|--command|-r|--execute)\b/i

/** Process substitution / here-string yang memasukkan output perintah lain. */
const PROCESS_SUB = /<\s*\(|>\s*\(|<<<|\bsource\s+<|\.\s+<\(/

/** Pipe ke shell/interpreter — bentuk apa pun sumbernya. */
const PIPE_TO_SHELL =
  /\|\s*(?:sudo\s+)?(?:sh|bash|dash|zsh|ksh|python|python2|python3|node|deno|bun|perl|ruby|php|iex|Invoke-Expression)\b/i

/** Unduh ke berkas lalu jalankan berkas itu dalam satu baris. */
const DOWNLOAD_THEN_RUN =
  /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n]*?(?:-o|-O|--output|-OutFile)\s*(\S+)[^\n]*[;&|][^\n]*\b(?:sh|bash|dash|zsh|node|python3?|perl|ruby|php|\.\/)\b/i

/** Container escape: mount host root / privileged. */
const CONTAINER_ESCAPE =
  /\b(?:docker|podman|nerdctl)\b[^\n]*(?:--privileged|--pid[= ]host|--net(?:work)?[= ]host|-v\s*\/:|--volume\s*\/:|-v\s*\/etc|--cap-add[= ](?:ALL|SYS_ADMIN))/i

/** Pencarian rekursif dari root filesystem. */
const ROOT_SCAN = /\b(?:find|fd|ls|dir|du|tree|grep|rg)\b[^\n]*\s\/(?:\s|$)/i

/**
 * `rm` rekursif dengan target berbahaya.
 *
 * Dipisah dari denylist lama yang menganggap SETIAP `/` berbahaya — itu
 * memblokir `rm -rf node_modules/.cache` yang sah. Yang berbahaya: target root,
 * home, parent traversal, atau wildcard telanjang.
 *
 * Bentuk flag panjang (`--recursive`) ikut dikenali: fuzz menemukan
 * `rm --recursive --force /` lolos karena pola lama hanya mencari `-[a-z]*r`.
 *
 * Traversal dicek di mana pun dalam argumen, bukan hanya di awal kata: target
 * bisa dibungkus command substitution (`rm -rf $(pwd)/../..`) yang tidak bisa
 * kita evaluasi, tapi `..` yang menaik tetap terlihat.
 */
const RM_RECURSIVE = /\brm\b[^\n]*(?:\s-[a-z]*[rR]|\s--recursive\b|\s--dir\b)/i
const RM_DANGEROUS_TARGET =
  /(?:\s\/(?:\s|$|\*|;|&)|\s~(?:[/\\]\s*)?(?:\s|$|;|&)|\$\{?HOME\}?|\.\.(?:[/\\]|\s|$|;|&)|\s\*\s*(?:$|;|&)|--no-preserve-root)/

const STATIC_DENY: [RegExp, string][] = [
  // Fork bomb: definisi fungsi rekursif yang memanggil dirinya lewat pipe.
  // Pola longgar (bukan hanya `:(){ :|:& };:` literal) karena nama fungsi bisa
  // apa saja dan spasi bebas — fuzz menemukan varian yang terpecah oleh
  // substitusi variabel masih lolos bentuk ketat. `\}` opsional karena
  // normalisasi bisa menghilangkan bagian setelah pipe.
  [/(?:^|[;&|=]\s*)[\w:]+\s*\(\)\s*\{[^}]*\|[^}]*&/, "fork bomb"],
  [/\bmkfs\b/i, "format filesystem"],
  [/\bdd\s+if=/i, "raw disk write"],
  [/\bchmod\s+(-R\s+)?777\b/i, "permission 777"],
  [/\bshred\b/i, "secure delete"],
  [/\btruncate\b/i, "truncate file"],
  [/\bmv\s+[^;|]*\s+\/(?:etc|boot|usr|lib)\b/i, "overwrite system dir"],
  [/\bsudo\b[^\n]*\brm\b/i, "sudo rm"],
  [/\bpowershell\b[^\n]*-EncodedCommand/i, "encoded powershell"],
  [/>\s*\/dev\/(?:sda|nvme|hd[a-z])/i, "raw device write"],
  [/\b(?:del|erase)\b[^\n]*\/[sfaq]/i, "windows recursive delete"],
  [/\brmdir\b[^\n]*\/s/i, "windows recursive rmdir"],
  [/\bRemove-Item\b[^\n]*-Recurse/i, "powershell recursive delete"],
  [/\[System\.IO\.File\]::ReadAllText/i, "powershell file read"],
  [/\b(?:Invoke-Expression|iex)\b/i, "powershell dynamic eval"],
  [/\bawk\b[^\n]*\bsystem\s*\(/i, "awk system()"],
  [
    /(?:^|[;&|]\s*)(?:base64|xxd)[^\n]*\|\s*(?:sh|bash|python|python3|node|perl)\b/i,
    "decode|shell",
  ],
]

/**
 * Evaluasi satu perintah bash. Return alasan bila ditolak.
 *
 * Pemeriksaan dilakukan pada bentuk ternormalisasi DAN mentah: normalisasi
 * menutup bypass, sementara bentuk mentah menangkap pola yang justru hilang
 * saat quote dibuang (mis. `--upload-file "x"`).
 */
export function inspectBashCommand(rawCmd: string): BashVerdict {
  const raw = rawCmd
  const norm = normalizeCommand(rawCmd)
  const both = (re: RegExp): boolean => re.test(norm) || re.test(raw)

  for (const [re, reason] of STATIC_DENY) {
    if (both(re)) return { denied: true, reason }
  }
  if (both(RM_RECURSIVE) && both(RM_DANGEROUS_TARGET)) {
    return { denied: true, reason: "destructive rm" }
  }
  if (both(PROCESS_SUB)) return { denied: true, reason: "process substitution" }
  if (both(PIPE_TO_SHELL)) return { denied: true, reason: "pipe to interpreter" }
  if (both(DOWNLOAD_THEN_RUN)) return { denied: true, reason: "download then execute" }
  if (both(INLINE_INTERPRETER)) return { denied: true, reason: "inline interpreter code" }
  if (both(CONTAINER_ESCAPE)) return { denied: true, reason: "container escape" }
  if (both(ENV_DUMP)) return { denied: true, reason: "environment dump" }
  if (both(ENV_SECRET_REF)) return { denied: true, reason: "credential env reference" }
  if (both(UPLOAD_FLAG)) return { denied: true, reason: "file upload to network" }
  if (both(ROOT_SCAN)) return { denied: true, reason: "filesystem-root scan" }

  // Berkas sensitif: berbahaya bila dibaca/disalin ATAU dijadikan argumen
  // perintah jaringan. Menyebut `.env` dalam `echo` saja tidak diblokir.
  const touchesSensitive = both(SENSITIVE_TARGET) || both(SENSITIVE_DIR)
  if (touchesSensitive && (both(READERS) || /\b(?:curl|wget|nc|ncat|socat|scp)\b/i.test(norm))) {
    return { denied: true, reason: "sensitive file access" }
  }

  return { denied: false }
}
