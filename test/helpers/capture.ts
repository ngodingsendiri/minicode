// Penangkap output untuk test — dipindah dari src/ui/screens/panel.ts saat
// runPanel dihapus (REPL linier mengalirkan builtin langsung ke scrollback,
// tidak ada lagi overlay yang perlu menangkap console). Hanya test yang masih
// memakainya; produksi tidak.
//
// Jalankan `fn` sambil menangkap stdout/console.log menjadi array baris.
// Generic: nilai kembalian `fn` diteruskan lewat `value` agar caller bisa
// memeriksa hasil (mis. flag `handled`) tanpa mengandalkan exception.
import { stripAnsi } from "../../src/ui/render/theme.ts"

export function captureOutput<T>(fn: () => Promise<T>): Promise<{ lines: string[]; value: T }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    const origLog = console.log
    process.stdout.write = ((chunk: string | Uint8Array, ..._rest: unknown[]) => {
      const s = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
      for (const l of s.split("\n")) {
        const clean = stripAnsi(l.replace(/\s+$/, ""))
        if (clean.length) lines.push(clean)
      }
      return true
    }) as typeof process.stdout.write
    console.log = (...args: unknown[]) => {
      lines.push(stripAnsi(String(args.join(" ")).trim()))
    }
    fn().then(
      (value) => {
        process.stdout.write = origWrite
        console.log = origLog
        resolve({ lines, value })
      },
      (e) => {
        process.stdout.write = origWrite
        console.log = origLog
        reject(e)
      },
    )
  })
}
