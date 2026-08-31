// Formatter uang untuk UI biaya/anggaran.
//
// `toFixed(2)` merusak nilai kecil: `--budget 0.001` tampil sebagai `$0.00`,
// sehingga pesan pemutusnya berbunyi "$0.0601 > $0.00 - lewat batas" — user
// membaca batas nol padahal ia menyetel seperseribu dolar.
//
// Aturan: di bawah $1 pakai 4 desimal (satuan biaya per-run memang sekecil itu),
// $1 ke atas pakai 2 desimal seperti harga biasa.
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$?"
  return Math.abs(value) < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}
