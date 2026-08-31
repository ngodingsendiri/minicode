import { findSkill, loadSkills } from "../../src/skills/loader.ts"
import { renderTable } from "../../src/ui/render/table.ts"
import { c } from "../../src/ui/render/theme.ts"

const SKILLS_HELP = `minicode skills — skill markdown di .minicode/skills/*.md

  minicode skills list           daftar skill terpasang
  minicode skills show <nama>    tampilkan isi satu skill

  Di REPL, jalankan skill dengan /nama [argumen].`

export async function handleSkills(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  const cwdArg = getArg("--cwd")
  const sub = args[1]
  if (sub === "list" || sub === undefined) {
    const all = await loadSkills(cwdArg)
    if (all.length === 0) {
      console.log(c.dim("(belum ada skill - tambahkan berkas markdown di .minicode/skills/*.md)"))
      process.exit(0)
    }
    const tableData = all.map((s) => ({
      skill: c.yellow(`/${s.name}`),
      desc: s.description || "(tanpa deskripsi)",
    }))
    console.log(
      `\n${c.bold("Skill terpasang")}\n` +
        renderTable(
          [
            { header: "Perintah", key: "skill", width: 18 },
            { header: "Deskripsi", key: "desc", width: 56 },
          ],
          tableData,
        ) +
        "\n",
    )
    process.exit(0)
  }
  if (sub === "show") {
    // Tolak flag sebagai nama: `skills show --cwd x` adalah lupa argumen,
    // bukan permintaan skill bernama "--cwd".
    const name = args[2] && !args[2]!.startsWith("-") ? args[2] : undefined
    if (!name) {
      console.error("usage: minicode skills show <nama>")
      process.exit(1)
    }
    const s = await findSkill(name, cwdArg)
    if (!s) {
      console.error(`skill "${name}" tidak ditemukan - lihat: minicode skills list`)
      process.exit(1)
    }
    console.log(`${c.bold(c.cyan("/" + s.name))} ${c.dim("- " + s.description)}\n\n${s.body}`)
    process.exit(0)
  }
  const asked = sub === "--help" || sub === "-h"
  if (!asked) console.error(`subcommand skills tidak dikenal: ${sub}\n`)
  console.log(SKILLS_HELP)
  process.exit(asked ? 0 : 1)
}
