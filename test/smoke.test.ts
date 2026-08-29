import { expect, test } from "bun:test"
import { createSession } from "#minicore/core/index.ts"
import { allowAll, FakeProvider, finish, text } from "#minicore/test/fakes.ts"

test("minicode imports frozen minicore", async () => {
  const p = new FakeProvider([{ events: [text("ok"), finish("stop")] }])
  const s = createSession({ provider: p, permissions: allowAll })
  const r = await s.run("hi")
  expect(r.finalText).toBe("ok")
})
