import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export interface RunHookCtx {
  phase: "pre" | "post"
  prompt?: string
  cwd?: string
  result?: unknown
}

// 6.4 — hooks global opt-in: ~/.minicode/hooks/{pre,post}*.js dan
// .minicode/hooks/{pre,post}*.js. Berjalan sebagai node script terpisah
// dengan konteks di env MINICODE_HOOK_CTX (JSON). Opt-in via MINICODE_HOOKS=1
// supaya tidak mengubah perilaku default (aman, tanpa efek samping).
export function findRunHooks(cwd?: string): { pre: string[]; post: string[] } {
  const dirs: string[] = [join(homedir(), ".minicode", "hooks")]
  if (cwd) dirs.push(resolve(cwd, ".minicode", "hooks"))
  const out = { pre: [] as string[], post: [] as string[] }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".js")) continue
      if (f.includes("pre")) out.pre.push(join(dir, f))
      else if (f.includes("post")) out.post.push(join(dir, f))
    }
  }
  return out
}

export async function runRunHooks(phase: "pre" | "post", ctx: RunHookCtx): Promise<void> {
  if (process.env.MINICODE_HOOKS !== "1") return
  const hooks = findRunHooks(ctx.cwd)
  for (const file of hooks[phase]) {
    await new Promise<void>((res) => {
      const p = spawn(process.execPath, [file], {
        env: { ...process.env, MINICODE_HOOK_CTX: JSON.stringify(ctx) },
        stdio: "ignore",
      })
      p.on("error", () => {})
      p.on("exit", () => res())
    })
  }
}
