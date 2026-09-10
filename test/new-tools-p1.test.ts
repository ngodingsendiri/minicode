// P13 P1 tools: submit_result (structured output) + ask_user (gated, DI).
// Hermetic: tanpa jaringan, tanpa TTY (ask_user justru harus menolak).

import { expect, test } from "bun:test"
import { createPermissionHandler } from "../src/policy/permission.ts"
import { askUserTool, setAskTextFn } from "../src/tools/ask_user.ts"
import {
  clearSubmittedResult,
  getSubmittedResult,
  submitResultTool,
} from "../src/tools/submit_result.ts"

const mkctx = () => ({ signal: new AbortController().signal }) as never
const call = (name: string) => [{ name, args: {} } as never, {} as never] as const

async function check(
  h: { check: (c: never, d: never) => Promise<string> },
  name: string,
): Promise<string> {
  const [c, d] = call(name)
  return h.check(c, d)
}

test("submit_result: object diterima, array/string ditolak", async () => {
  clearSubmittedResult()
  expect(getSubmittedResult()).toBeNull()
  const out = (await submitResultTool.execute(
    { result: { status: "ok", files: 3 }, summary: "selesai" },
    mkctx(),
  )) as string
  expect(out).toContain("submitted")
  expect(getSubmittedResult()?.result).toEqual({ status: "ok", files: 3 })
  let threw = ""
  try {
    await submitResultTool.execute({ result: ["bukan", "object"] }, mkctx())
  } catch (e) {
    threw = (e as Error).message
  }
  expect(threw).toContain("must be a JSON object")
  clearSubmittedResult()
})

test("submit_result: tanpa prompt di ask/plan, ditolak di readonly", async () => {
  const ask = createPermissionHandler({ mode: "ask", root: process.cwd() })
  expect(await check(ask, "submit_result")).toBe("allow")
  const ro = createPermissionHandler({ mode: "readonly", root: process.cwd() })
  expect(await check(ro, "submit_result")).toBe("deny")
  // Plan mengizinkan: singleton memori-proses tanpa tulis file/state sesi,
  // konsisten dengan visibilitas PLAN_EXTRA di tool-layer.
  const plan = createPermissionHandler({ mode: "plan", root: process.cwd() })
  expect(await check(plan, "submit_result")).toBe("allow")
})

test("ask_user: tanpa injeksi atau non-TTY → tolak (fail-closed)", async () => {
  setAskTextFn(undefined)
  let threw = ""
  try {
    await askUserTool.execute({ question: "lanjut?" }, mkctx())
  } catch (e) {
    threw = (e as Error).message
  }
  expect(threw).toContain("no question view injected")
  // Di mesin CI non-TTY, injeksi pun tetap menolak — tidak boleh gantung.
  setAskTextFn(async () => "ya")
  try {
    if (!process.stdin.isTTY) {
      threw = ""
      try {
        await askUserTool.execute({ question: "lanjut?" }, mkctx())
      } catch (e) {
        threw = (e as Error).message
      }
      expect(threw).toContain("interactive terminal")
    }
  } finally {
    setAskTextFn(undefined)
  }
})

test("ask_user: di-gate (prompt di ask/auto, deny di readonly/plan/allowlist)", async () => {
  for (const mode of ["readonly", "plan", "allowlist"] as const) {
    const h = createPermissionHandler({ mode, root: process.cwd() })
    expect(await check(h, "ask_user")).toBe("deny")
  }
  // ask + auto tanpa injeksi `ask` permission → deny (fail-closed, tanpa gantung)
  const ask = createPermissionHandler({ mode: "ask", root: process.cwd() })
  expect(await check(ask, "ask_user")).toBe("deny")
  const auto = createPermissionHandler({ mode: "auto", root: process.cwd() })
  expect(await check(auto, "ask_user")).toBe("deny")
})

test("ask_user: question kosong ditolak sebelum sentuh view", async () => {
  let called = false
  setAskTextFn(async () => {
    called = true
    return "x"
  })
  try {
    let threw = ""
    try {
      await askUserTool.execute({ question: "   " }, mkctx())
    } catch (e) {
      threw = (e as Error).message
    }
    expect(threw).toContain("question empty")
    expect(called).toBe(false)
  } finally {
    setAskTextFn(undefined)
  }
})
