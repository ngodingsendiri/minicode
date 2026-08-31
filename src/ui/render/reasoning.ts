// Satu sumber state "tampilkan reasoning".
//
// Sebelumnya ada DUA state terpisah dan nol konsumen: cli/commands.ts menulis
// process.env.MINICODE_SHOW_THINKING sementara renderer lama menulis
// showThinking.ref — tidak ada yang membaca yang lain, dan tidak ada renderer
// yang membaca keduanya. `/thinking` melaporkan sukses tanpa mengubah apa pun.
export const reasoning = { visible: process.env.MINICODE_SHOW_THINKING === "1" }

/** Set eksplisit (on/off) atau toggle bila `next` tidak diberikan. */
export function setReasoningVisible(next?: boolean): boolean {
  reasoning.visible = next ?? !reasoning.visible
  // Env tetap disinkronkan supaya sub-proses (respawn /resume, plan re-exec)
  // mewarisi pilihan user.
  process.env.MINICODE_SHOW_THINKING = reasoning.visible ? "1" : "0"
  return reasoning.visible
}
