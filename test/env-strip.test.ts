import { describe, expect, test } from "bun:test"
import { SECRET_ENV_RE, sanitizeSpawnEnv, stripSecretsEnv } from "../src/policy/scrub.ts"

describe("env sanitization (C1)", () => {
  test("stripSecretsEnv removes credential-named vars", () => {
    const env = {
      OPENAI_API_KEY: "sk-x",
      DEEPSEEK_API_KEY: "ds-x",
      AWS_SECRET_ACCESS_KEY: "aws-x",
      DATABASE_URL: "postgres://u:p@h/db",
      MY_TOKEN: "t",
      PATH: "C:\\bin",
      SystemRoot: "C:\\Windows",
      HOME: "/home/u",
    }
    const out = stripSecretsEnv(env) as Record<string, string>
    expect(out.OPENAI_API_KEY).toBeUndefined()
    expect(out.DEEPSEEK_API_KEY).toBeUndefined()
    expect(out.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(out.DATABASE_URL).toBeUndefined()
    expect(out.MY_TOKEN).toBeUndefined()
    // non-secret infra vars tetap ada (docker.exe/lsp butuh PATH dll)
    expect(out.PATH).toBe("C:\\bin")
    expect(out.SystemRoot).toBe("C:\\Windows")
    expect(out.HOME).toBe("/home/u")
  })

  test("sanitizeSpawnEnv strips secrets from the FINAL merge", () => {
    const base = { PATH: "/usr/bin", OPENAI_API_KEY: "sk-base" }
    const extra = { FOO: "bar" }
    const out = sanitizeSpawnEnv(base as NodeJS.ProcessEnv, extra)
    expect(out.FOO).toBe("bar")
    expect(out.PATH).toBe("/usr/bin")
    expect(out.OPENAI_API_KEY).toBeUndefined()
  })

  test("extra cannot re-introduce a secret past sanitizeSpawnEnv", () => {
    const out = sanitizeSpawnEnv({ A: "1" } as NodeJS.ProcessEnv, {
      ANTHROPIC_API_KEY: "sk-evil",
    })
    expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    expect(out.A).toBe("1")
  })

  test("SECRET_ENV_RE coverage sanity", () => {
    for (const k of ["GITHUB_TOKEN", "client_secret", "privateKey", "ACCESS_KEY_ID"])
      expect(SECRET_ENV_RE.test(k)).toBe(true)
    for (const k of ["PATH", "LANG", "EDITOR", "SHELL"]) expect(SECRET_ENV_RE.test(k)).toBe(false)
  })
})
