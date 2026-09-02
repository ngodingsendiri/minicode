// Satu sumber state "tampilkan reasoning".
//
// Getter — jangan simpan `reasoning.visible` ke const di module scope; lihat
// detail.ts. Perubahan env (mis. /thinking) harus terbaca saat pakai.
export const reasoning = {
  get visible(): boolean {
    return process.env.MINICODE_SHOW_THINKING === "1"
  },
  set visible(v: boolean) {
    process.env.MINICODE_SHOW_THINKING = v ? "1" : "0"
  },
}

/** Set eksplisit (on/off) atau toggle bila `next` tidak diberikan. */
export function setReasoningVisible(next?: boolean): boolean {
  const cur = reasoning.visible
  const nextVal = next ?? !cur
  reasoning.visible = nextVal
  return nextVal
}
