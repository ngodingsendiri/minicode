// Satu sumber state "level detail tool call": expanded (default) vs compact.
//
// Posisi MiniCode = agentic Unix shell: tool call transparan di aliran output,
// jadi DEFAULT adalah expanded. `MINICODE_COMPACT=1` atau `/compact` memilih
// ringkas. Getter — jangan simpan `detail.compact` ke const di module scope;
// baca saat pakai supaya perubahan env (mis. /compact) langsung berlaku.
export const detail = {
  get compact(): boolean {
    return process.env.MINICODE_COMPACT === "1"
  },
  set compact(v: boolean) {
    process.env.MINICODE_COMPACT = v ? "1" : "0"
  },
}

/** Set eksplisit (on/off) atau toggle bila `next` tidak diberikan. */
export function setCompactMode(next?: boolean): boolean {
  const cur = detail.compact
  const nextVal = next ?? !cur
  detail.compact = nextVal
  return nextVal
}
