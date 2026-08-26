import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  SENSITIVE_RE,
  isPathOutsideRoot,
  isRealPathOutsideRoot,
  isSensitive,
} from "../src/policy/jail.ts"

test("isSensitive: sensitive paths blocked (incl. new coverage)", () => {
  const positives = [
    ".env",
    ".env.local",
    "app/.env",
    ".git/config",
    ".git/credentials",
    ".git-credentials",
    "~/.npmrc",
    ".netrc",
    ".ssh/id_ed25519",
    ".aws/credentials",
    ".kube/config",
    ".docker/config.json",
    "keys/id_rsa",
    "id_ecdsa.pub",
    "server.pem",
    "server.key",
    "cert.p12",
    "cert.pfx",
    "ks.jks",
    "credentials.json",
    "secrets.yaml",
    "secret.yml",
    "terraform.tfvars",
    "terraform.prod.tfvars",
    "a/b/node_modules/c.js",
    "node_modules",
  ]
  for (const p of positives) expect(isSensitive(p), p).toBe(true)
})

test("isSensitive: normal files NOT blocked (anchor fix)", () => {
  const negatives = [
    "src/index.ts",
    "mynode_modules.txt",
    "docs/node-modules-guide.md", // hyphen, bukan segmen node_modules
    "notes/env.md",
    "environment.ts",
    "src/env-loader.ts",
    "package.json",
    "bun.lockb",
    "README.md",
  ]
  for (const p of negatives) expect(isSensitive(p), p).toBe(false)
})

test("SENSITIVE_RE no longer matches bare 'node_modules' substring mid-name", () => {
  // bug lama: regex tanpa anchor → "my_node_modules_notes" ikut terblokir
  expect(SENSITIVE_RE.test("my_node_modules_notes.txt")).toBe(false)
  expect(isSensitive("my_node_modules_notes.txt")).toBe(false)
})

test("isRealPathOutsideRoot detects symlink escape that logical check misses", async () => {
  const root = await mkdtemp(join(tmpdir(), "minicode-jail-"))
  try {
    await mkdir(join(root, "sub"), { recursive: true })
    const outsideDir = await mkdtemp(join(tmpdir(), "minicode-out-"))
    await writeFile(join(outsideDir, "secret.txt"), "x")
    let linkMade = false
    try {
      await symlink(join(outsideDir, "secret.txt"), join(root, "sub", "link.txt"))
      linkMade = true
    } catch {
      // Windows tanpa privilege symlink — lewati bagian symlink
    }
    if (linkMade) {
      const rel = "sub/link.txt"
      expect(isPathOutsideRoot(rel, root)).toBe(false) // cek logis lolos
      expect(isRealPathOutsideRoot(rel, root)).toBe(true) // realpath menangkap
    }
    // file baru (ENOENT) → fallback logis, tidak dianggap keluar
    expect(isRealPathOutsideRoot(`new-${randomUUID().slice(0, 4)}.txt`, root)).toBe(false)
    // traversal klasik tetap tertangkap kedua varian
    expect(isRealPathOutsideRoot("../outside.txt", root)).toBe(true)
    expect(isPathOutsideRoot("../outside.txt", root)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
