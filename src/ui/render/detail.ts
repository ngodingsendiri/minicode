// Satu sumber state "level detail tool call": expanded (default) vs compact.
//
// Posisi MiniCode = agentic Unix shell: tool call transparan di aliran output,
// jadi DEFAULT adalah expanded. `MINICODE_COMPACT=1` atau `/compact` memilih
// ringkas. Pola identik dengan reasoning.ts: env dibaca saat import dan
// disinkronkan balik saat toggle supaya sub-proses (respawn /resume) mewarisi.
export const detail = { compact: process.env.MINICODE_COMPACT === "1" }

/** Set eksplisit (on/off) atau toggle bila `next` tidak diberikan. */
export function setCompactMode(next?: boolean): boolean {
  detail.compact = next ?? !detail.compact
  process.env.MINICODE_COMPACT = detail.compact ? "1" : "0"
  return detail.compact
}
