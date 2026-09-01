import { afterEach, describe, expect, test } from "bun:test"
import { promptAsk } from "../src/ui/approval/prompt.ts"
import { type FakeTty, installFakeTty } from "./helpers/tui-harness.ts"

let tty: FakeTty | undefined

afterEach(() => {
  tty?.restore()
  tty = undefined
  delete process.env.MINICODE_BELL
})

describe("approval prompt bell accessibility", () => {
  test("default emits terminal bell", async () => {
    tty = installFakeTty({ isTTY: true })
    const p = promptAsk({ name: "bash", args: { command: "ls" } })
    await tty.ready()
    await tty.send("n\r")
    const ans = await p
    expect(ans).toBe("deny")
    expect(tty.all()).toContain("\x07")
  })

  test("MINICODE_BELL=0 suppresses bell", async () => {
    process.env.MINICODE_BELL = "0"
    tty = installFakeTty({ isTTY: true })
    const p = promptAsk({ name: "bash", args: { command: "ls" } })
    await tty.ready()
    await tty.send("n\r")
    const ans = await p
    expect(ans).toBe("deny")
    expect(tty.all()).not.toContain("\x07")
  })
})
