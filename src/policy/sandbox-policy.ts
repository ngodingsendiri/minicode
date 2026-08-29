// Resolusi mode sandbox untuk eksekusi bash.
//
// Sebelum ini: default = tanpa sandbox, `--sandbox` murni opt-in. Konsekuensinya
// pengguna yang tidak tahu harus mengetik flag berjalan dengan blocklist regex
// sebagai satu-satunya pertahanan. Blocklist menaikkan biaya serangan tapi tidak
// menutupnya (lihat experiments/bash-bypass-probe.ts).
//
// Sekarang: bila OS sandbox tersedia (bubblewrap di Linux, seatbelt di macOS),
// pakai secara default. Bila tidak — termasuk SEMUA Windows, di mana keduanya
// tidak ada — jangan berpura-pura terisolasi: turunkan permission default ke
// mode `allowlist` dan katakan alasannya sekali.
//
// Prinsip: jangan pernah menjanjikan isolasi yang tidak bisa dipenuhi. Lebih
// baik membatasi perintah (allowlist) daripada menjalankan apa pun sambil
// menampilkan label "sandboxed".

import { dockerAvailable } from "../sandbox/docker.ts"
import { osSandboxAvailable, osSandboxTypeName } from "../sandbox/os.ts"

export type SandboxMode = "docker" | "os" | "none"

export interface SandboxResolution {
  /** Mode yang benar-benar dipakai bash. */
  mode: SandboxMode
  /** true bila user menyebut --sandbox / MINICODE_SANDBOX secara eksplisit. */
  explicit: boolean
  /** Downgrade permission yang disarankan bila tak ada isolasi nyata. */
  fallbackPermission?: "allowlist"
  /** Pesan sekali-jalan untuk stderr; kosong = tak perlu bicara. */
  notice?: string
}

/**
 * Tentukan sandbox efektif.
 *
 * `requested` berasal dari `--sandbox` atau `MINICODE_SANDBOX`.
 * `explicitPermission` = user sudah memilih mode permission sendiri (mis.
 * `--allow-all`, `--ask`, `--plan`), sehingga kita tidak menimpanya.
 *
 * Fungsi ini pure terhadap argumen; deteksi lingkungan disuntik lewat `probes`
 * agar bisa diuji tanpa Docker/bwrap.
 */
export function resolveSandbox(
  requested: string | undefined,
  explicitPermission: boolean,
  probes: { os?: () => boolean; docker?: () => boolean; platform?: string } = {},
): SandboxResolution {
  const hasOs = probes.os ?? osSandboxAvailable
  const hasDocker = probes.docker ?? dockerAvailable
  const platform = probes.platform ?? process.platform

  const req = (requested ?? "").trim().toLowerCase()

  // ── permintaan eksplisit: hormati, tapi jangan diam bila tak tersedia ──
  if (req === "docker") {
    if (hasDocker()) return { mode: "docker", explicit: true }
    return {
      mode: "none",
      explicit: true,
      fallbackPermission: explicitPermission ? undefined : "allowlist",
      notice:
        "[sandbox] docker diminta tapi daemon tidak tersedia — tanpa isolasi" +
        (explicitPermission ? "" : "; permission diturunkan ke allowlist"),
    }
  }
  if (req === "os" || req === "bwrap" || req === "seatbelt") {
    if (hasOs()) return { mode: "os", explicit: true }
    return {
      mode: "none",
      explicit: true,
      fallbackPermission: explicitPermission ? undefined : "allowlist",
      notice:
        `[sandbox] os sandbox tidak tersedia di ${platform}` +
        (platform === "win32" ? " (bubblewrap/seatbelt hanya Linux/macOS)" : "") +
        (explicitPermission ? " — tanpa isolasi" : " — permission diturunkan ke allowlist"),
    }
  }
  if (req === "none" || req === "off" || req === "0") {
    // Opt-out sadar. Tidak ada downgrade, tidak ada ceramah.
    return { mode: "none", explicit: true }
  }
  if (req) {
    return {
      mode: "none",
      explicit: false,
      notice: `[sandbox] mode "${requested}" tidak dikenal — pakai docker|os|none`,
    }
  }

  // ── tanpa permintaan: pilih yang paling aman yang tersedia ──
  if (hasOs()) {
    return {
      mode: "os",
      explicit: false,
      notice: `[sandbox] aktif otomatis: ${osSandboxTypeName()} (--sandbox none untuk menonaktifkan)`,
    }
  }
  // Docker TIDAK dipakai otomatis: menarik image dan menjalankan container
  // tanpa diminta terlalu invasif untuk sebuah default.
  return {
    mode: "none",
    explicit: false,
    fallbackPermission: explicitPermission ? undefined : "allowlist",
    notice: explicitPermission
      ? undefined
      : `[sandbox] tidak ada OS sandbox di ${platform} — permission default = allowlist. ` +
        "Pakai --allow-all / --ask untuk memilih sendiri, atau --sandbox docker untuk isolasi.",
  }
}
