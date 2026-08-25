import { expect, test } from "bun:test"
import { renderTable } from "../src/tui/table.ts"
import { stripAnsi } from "../src/tui/theme.ts"

test("table: renders empty state", () => {
  const table = renderTable([{ header: "Name", key: "name" }], [])
  expect(table).toContain("(no entries)")
})

test("table: renders headers and aligned data rows", () => {
  const columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Score", key: "score", width: 6, align: "right" as const },
  ]
  const data = [
    { id: "item1", score: 95 },
    { id: "item2", score: 100 },
  ]

  const table = renderTable(columns, data)
  const clean = stripAnsi(table)
  expect(clean).toContain("ID")
  expect(clean).toContain("Score")
  expect(clean).toContain("item1")
  expect(clean).toContain("95")
  expect(clean).toContain("item2")
  expect(clean).toContain("100")
})
