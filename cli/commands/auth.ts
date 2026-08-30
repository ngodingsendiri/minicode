import { loadConfig, saveProvider } from "../../src/config.ts"
import { authFilePath, listAuth, removeAuth } from "../../src/providers/auth-store.ts"
import { detectModels } from "../../src/providers/detect.ts"
import {
  findOAuthProvider,
  loginWithDeviceFlow,
  OAUTH_PROVIDERS,
} from "../../src/providers/oauth.ts"
import { c, glyphs } from "../../src/tui/theme.ts"

function usage(code = 0): never {
  console.log(`minicode auth — login OAuth (tanpa API key)

  minicode auth login [provider]   masuk via device code
  minicode auth status             lihat kredensial tersimpan
  minicode auth logout <provider>  hapus kredensial
  minicode auth list               provider yang mendukung OAuth

Token disimpan di ${authFilePath()} (chmod 600), TIDAK di config.json.`)
  process.exit(code)
}

export async function handleAuth(args: string[]): Promise<never> {
  const sub = (args[1] ?? "").toLowerCase()

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") usage()

  if (sub === "list") {
    console.log(`\n${c.bold("Provider dengan dukungan OAuth")}`)
    for (const p of OAUTH_PROVIDERS) {
      console.log(`  ${c.cyan(p.id.padEnd(12))} ${p.label}`)
      if (p.note) console.log(`  ${" ".repeat(12)} ${c.dim(p.note)}`)
    }
    console.log(`\n  ${c.dim("login:")} minicode auth login ${OAUTH_PROVIDERS[0]?.id ?? "<id>"}\n`)
    process.exit(0)
  }

  if (sub === "status") {
    const rows = await listAuth()
    if (rows.length === 0) {
      console.log(`\n(belum ada kredensial OAuth — ${c.dim("minicode auth login")})\n`)
      process.exit(0)
    }
    console.log(`\n${c.bold("Kredensial OAuth")}  ${c.dim(authFilePath())}`)
    for (const r of rows) {
      const exp = r.expiresAt ? new Date(r.expiresAt).toLocaleString() : "-"
      const state = r.expired
        ? r.hasRefresh
          ? c.yellow("kedaluwarsa (auto-refresh)")
          : c.red("kedaluwarsa (perlu login ulang)")
        : c.green("aktif")
      console.log(`  ${c.cyan(r.providerId.padEnd(12))} ${state}  ${c.dim(`exp ${exp}`)}`)
    }
    console.log("")
    process.exit(0)
  }

  if (sub === "logout") {
    const id = args[2]
    if (!id) {
      console.error("usage: minicode auth logout <provider>")
      process.exit(1)
    }
    const ok = await removeAuth(id)
    console.log(
      ok
        ? `${c.green(glyphs.check)} kredensial "${id}" dihapus`
        : `(tidak ada kredensial untuk "${id}")`,
    )
    process.exit(0)
  }

  if (sub !== "login") {
    // Subcommand asing = salah pakai, bukan permintaan bantuan: exit 1.
    console.error(`subcommand auth tidak dikenal: ${sub}`)
    usage(1)
  }

  // ── login ──
  const requested = args[2] ?? OAUTH_PROVIDERS[0]?.id
  if (!requested) {
    console.error("tidak ada provider OAuth terdaftar")
    process.exit(1)
  }
  const spec = findOAuthProvider(requested)
  if (!spec) {
    console.error(
      `provider "${requested}" tidak mendukung OAuth. Yang tersedia: ${OAUTH_PROVIDERS.map((p) => p.id).join(", ")}`,
    )
    process.exit(1)
  }

  console.log(`\n${c.bold(`Login ${spec.label}`)}`)
  if (spec.note) console.log(c.dim(`  ${spec.note}`))

  // Ctrl+C harus membatalkan polling, bukan meninggalkan proses menggantung.
  const ac = new AbortController()
  const onSigint = () => {
    console.log(`\n${c.yellow("dibatalkan")}`)
    ac.abort()
  }
  process.once("SIGINT", onSigint)

  try {
    const creds = await loginWithDeviceFlow(spec, {
      signal: ac.signal,
      onPrompt: (info) => {
        console.log(`\n  1. Buka: ${c.cyan(info.verificationUriComplete ?? info.verificationUri)}`)
        if (!info.verificationUriComplete) {
          console.log(`  2. Masukkan kode: ${c.bold(info.userCode)}`)
        }
        console.log(`\n  ${c.dim("menunggu persetujuan… (Ctrl+C untuk batal)")}`)
      },
      onPoll: (elapsed) => {
        // satu baris yang di-overwrite, bukan spam per-poll
        process.stderr.write(`\r  ${c.dim(`${elapsed}s…`)}   `)
      },
    })
    process.stderr.write("\r                    \r")
    console.log(`${c.green(glyphs.check)} login berhasil`)

    // Daftarkan provider bila belum ada. apiKey dibiarkan kosong: tokennya
    // hidup di auth.json dan diambil saat runtime oleh buildProviderListAsync.
    const cfg = await loadConfig()
    const existing = cfg.providers.find((p) => p.id === spec.id)
    let models = existing?.models ?? []
    if (models.length === 0) {
      try {
        const detected = await detectModels(spec.apiBaseUrl, creds.accessToken)
        models = detected.models.length ? detected.models : spec.fallbackModels
      } catch {
        models = spec.fallbackModels
      }
    }
    await saveProvider(
      {
        id: spec.id,
        baseUrl: spec.apiBaseUrl,
        apiKey: "",
        auth: "oauth",
        models,
      },
      { global: true },
    )
    console.log(
      `${c.green(glyphs.check)} provider "${c.bold(spec.id)}" siap (${models.length} model)\n` +
        `  ${c.dim(`coba: minicode --provider ${spec.id} "hello"`)}\n`,
    )
    process.exit(0)
  } catch (e) {
    process.stderr.write("\r                    \r")
    console.error(`${c.red(glyphs.cross)} ${(e as Error).message}`)
    process.exit(1)
  } finally {
    process.off("SIGINT", onSigint)
  }
}
