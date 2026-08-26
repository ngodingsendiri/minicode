import { findSkill, loadSkills } from "../../src/skills/loader.ts"
import { renderTable } from "../../src/tui/table.ts"
import { c } from "../../src/tui/theme.ts"

export async function handleSkills(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  const cwdArg = getArg("--cwd")
  const all = await loadSkills(cwdArg)
  if (args[1] === "list" || !args[1]) {
    if (all.length === 0)
      console.log(c.dim("(no skills found - add markdown files in .minicode/skills/*.md)"))
    else {
      const tableData = all.map((s) => ({
        skill: c.yellow(`/${s.name}`),
        desc: s.description || "(no description)",
      }))
      console.log(
        `\n${c.bold("Installed Agent Skills")}\n` +
          renderTable(
            [
              { header: "Skill Command", key: "skill", width: 18 },
              { header: "Description", key: "desc", width: 50 },
            ],
            tableData,
          ) +
          "\n",
      )
    }
  } else if (args[1] === "show") {
    const s = await findSkill(args[2] ?? "", cwdArg)
    if (!s) {
      console.error(`skill ${args[2]} not found`)
      process.exit(1)
    }
    console.log(`${c.bold(c.cyan("/" + s.name))} ${c.dim("- " + s.description)}\n\n${s.body}`)
  }
  process.exit(0)
}
