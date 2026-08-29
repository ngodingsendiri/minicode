// Wrapper untuk `bun run test:live` — menjalankan bun test dengan MINICODE_LIVE=1.
import { spawn } from "node:child_process"

const child = spawn(process.execPath, ["test", "test/extreme-live.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, MINICODE_LIVE: "1" },
})
child.on("exit", (code) => process.exit(code ?? 0))
