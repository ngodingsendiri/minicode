# PLAN V5 — Sisa V4 + Eksperimen Ekstrem

**Status:** ✅ selesai. Semua item di dokumen ini sudah dikerjakan dan diverifikasi.

Lanjutan dari [PLAN_V4.md](PLAN_V4.md) bagian "Sisa yang belum dikerjakan", ditambah tiga harness eksperimen adversarial yang **menemukan empat bug nyata**.

| Metrik | Setelah V4 | Setelah V5 |
|---|---|---|
| Test | 569 (561 pass) | **646 (638 pass)** |
| Tools | 29 | **31** (`mcp_read`, `mcp_prompt`) |
| Bypass bash (korpus manual 38 pola) | 0 | 0 |
| Bypass bash (**fuzz kombinatorial**) | belum diuji | **0 dari ~13.000 varian** |
| Gate CI | 14 langkah | **18 langkah** |
| Distribusi | `bun install` lokal hijau | **tarball npm terpasang & berjalan** |
| MCP client | tools saja | tools + resources + prompts |

---

## 1. Eksperimen ekstrem — empat bug ditemukan

Probe lama (`bash-bypass-probe.ts`) hanya membuktikan guard menahan serangan **yang sudah saya pikirkan**. Tiga harness baru membangkitkan kasus sendiri.

### 1.1 `extreme-bash-fuzz.ts` — 3 bypass

Mutasi kombinatorial dari transformasi yang **shell anggap setara**: quote-split, indirection variabel (nama perintah maupun argumen), rantai dua tingkat, flag panjang, wrapper perintah, chaining, path noise. Rantai kedalaman 1–3, PRNG deterministik dengan `--seed` supaya temuan bisa direproduksi.

Run pertama: **101 bypass (52 unik)** dari 2.435 varian. Tiga kelas akar:

| Bypass | Kenapa lolos | Perbaikan |
|---|---|---|
| `command env`, `nice env`, `exec 'env'`, `time env` | Deteksi env-dump ter-anchor ke awal perintah; wrapper menggeser posisi kata | `stripCommandWrappers()` — buang 14 wrapper (`command`/`exec`/`nice`/`nohup`/`setsid`/`timeout N`/`stdbuf`/`sudo`/…) berulang hingga 4 lapis, sebelum pemeriksaan |
| `rm --recursive --force /` | Pola lama hanya mencari `-[a-z]*r`, bentuk GNU long-option tak dikenali | `RM_RECURSIVE` menerima `--recursive`/`--dir` |
| `rm -rf /; :` | Pola target mensyaratkan whitespace/akhir-string; `;` menempel langsung | `RM_DANGEROUS_TARGET` menerima `;`/`&` sebagai pembatas |
| `b(){ b\|b& };b`, varian terpecah variabel | Pola fork bomb literal `:(){ :\|:& };:` | Pola struktural: definisi fungsi apa pun yang memuat pipe + `&` |

Setelah perbaikan: **0 bypass** pada 6 seed berbeda dan pada run panjang (20 round, 12.912 varian berbahaya + 2.400 varian sah).

**Dua "bypass" yang ternyata palsu** — dan ini mengubah harness, bukan guard. Mutator kosmetik (`space-pad`) yang berjalan **sebelum** indirection menyisipkan tab di tengah kata, menghasilkan `C=find\t/; ${C} -name x`. Di shell nyata itu berarti "assign `C=find`, lalu jalankan `/` sebagai perintah" — payload-nya rusak, mencari dari cwd bukan root. Guard benar membiarkannya lewat. Harness diperbaiki: mutator dipisah **struktural** vs **kosmetik**, kosmetik hanya di akhir rantai, dan pemisahan kata memakai `\s+` bukan `" "`. Perilaku yang benar didokumentasikan sebagai test, bukan disembunyikan.

### 1.2 `extreme-shadow-git.ts` — 31 pemeriksaan, 0 gagal

Delapan area: skala (hing 5.000 file), operasi campur (tulis+hapus+rename+nested), konkurensi (10 sesi snapshot paralel), restore saat file berubah, nama file ekstrem (unicode, emoji, spasi, 120 karakter, diawali `-`), `.gitignore` di kedua arah, cap manifest, dan integritas repo user.

Pengukuran yang menjawab klaim "O(delta)":

| File | Snapshot | Undo | Manifest |
|---|---|---|---|
| 200 | 282 ms | 425 ms | 364 B |
| 1.000 | 604 ms | 750 ms | 364 B |
| 5.000 | 522 ms | 701 ms | 364 B |

Waktu **tidak** tumbuh linear terhadap jumlah file (git `add -A` men-stat semua tapi hanya menulis object yang berubah), dan manifest **konstan** karena hanya menyimpan SHA. Klaim di PLAN_V4 terkonfirmasi.

Konkurensi: 10 sesi paralel menghasilkan tree identik, ref terpisah per sesi, dan **tidak ada index sementara yatim** di `.git`.

### 1.3 `extreme-mcp-adversarial.ts` — 1 bug

Server yang sengaja jahat: membisu, membanjiri SSE tanpa balasan, mengirim 512 MB, redirect ke metadata endpoint, session id 5.000 karakter, status HTTP tak lazim, balasan cacat.

**Bug: balasan untuk request lain diterima sebagai hasil.** Server yang membalas `{"id": 4242, "result": {...}}` terhadap request `id: 1` — atau hanya mengirim notifikasi tanpa `id` — diterima sebagai sukses, dan `result: undefined` menjalar ke pemanggil. Jalur SSE sudah mencocokkan `id`; jalur JSON tidak. `readJsonResponse` kini menerima `expectId` dan memakai `matchResponse` yang sama.

Diverifikasi juga: heap tidak tumbuh (+0 MB) saat server mengirim 512 MB, `Authorization` tidak muncul di pesan error, dan 13 pola host privat ditolak konsisten dengan `web_fetch`.

---

## 2. MCP resources & prompts ✅

Sisi *server* minicode sudah lama menyajikan `resources`/`prompts`; client hanya memakai `tools`. Asimetri itu ditutup.

- `initialize` kini mendeklarasikan `{ tools, resources, prompts }` — sebelumnya hanya `tools`, sehingga server yang sopan tidak menawarkan sisanya sama sekali.
- Discovery keduanya **opsional**: server yang membalas "Method not found" (mayoritas ekosistem) tetap terhubung dengan tool-nya utuh.
- Tool baru: `mcp_read` (spec `resources/read`) dan `mcp_prompt` (spec `prompts/get` — server merender argumennya).
- `mcp_list` kini menampilkan tiga kategori sekaligus.

**Keputusan izin:** `mcp_read` dan `mcp_prompt` **di-gate** meski read-only. Keduanya menarik konten dari server pihak ketiga langsung ke konteks model — itu jalur prompt-injection, dan "read-only" tidak berarti "aman". `mcp_list` tidak di-gate karena hanya melaporkan metadata server yang user daftarkan sendiri.

Blob biner dari `resources/read` **tidak** ditumpahkan sebagai base64: 2.000 karakter base64 memakan konteks tanpa memberi informasi. Diganti penanda `[binary image/png, N char base64 — dilewati]`.

---

## 3. Distribusi npm ✅

`bun install` lokal sudah hijau sejak V4 (vendor), tapi **tarball npm gagal**: dependency `minicore: file:./vendor/minicore` di-resolve relatif terhadap cache Bun, bukan terhadap paket terpasang.

```
error: Could not find package.json for "file:../../../../../.bun/install/cache/@T@.../vendor/minicore"
```

Diganti **subpath imports** (`package.json` `imports`), fitur Node/Bun yang justru dirancang untuk ini:

```json
"imports": {
  "#minicore": "./vendor/minicore/src/core/index.ts",
  "#minicore/*": "./vendor/minicore/src/*"
}
```

73 import site di 51 file dimigrasikan dari `minicore` ke `#minicore`. Kernel bukan dependency lagi — `dependencies` kini kosong.

Terverifikasi end-to-end: `npm pack` → `bun install <tarball>` di proyek bersih → `minicode --help --json`, `pricing status`, `auth list` semuanya berjalan lewat `node_modules/.bin/minicode`.

### 3.1 `scripts/pack-check.ts` — gate distribusi

Field `files` mudah tertinggal saat file baru ditambahkan, dan kegagalannya hanya muncul **setelah publish** saat user pertama mendapat "Cannot find module". Gate ini menelusuri graf import dari `bin` (98 modul), memverifikasi setiap target relatif ikut terkemas, memeriksa vendor lengkap untuk 12 spesifier `#minicore/*`, dan menolak 14 pola berkas rahasia/sampah (`.env`, `auth.json`, `*.db`, `.tgz`, `.minicode/`, `node_modules/`, `test/`, `id_rsa`, …).

Hasil: 124 file, 697 KB unpacked, 222 KB tarball, 22 pemeriksaan lulus.

---

## 4. Dua bug dari migrasi itu sendiri

Penggantian teks massal di 51 file menghasilkan dua kesalahan yang **lolos typecheck**:

**Nama direktori ikut terganti.** `resolve(repoRoot, "..", "minicore")` menjadi `"..", "#minicore"` — `vendor:check` melapor "vendor kosong" padahal ada 20 file. `#` hanya bermakna untuk spesifier import, bukan path filesystem.

**Karakter non-ASCII rusak.** File yang ditulis ulang lewat pipeline PowerShell tanpa encoding eksplisit mengubah `—`, `…`, `─` menjadi U+FFFD di 2 file (9 dan 2 kemunculan). Satu assertion test gagal karena string yang dibandingkan memuat `…`. Diperbaiki dengan memulihkan dari `git show HEAD:<file>` lalu menerapkan ulang perubahan yang dimaksud.

Sekalian ditemukan: `tsconfig.json` punya BOM, yang membuat `JSON.parse` gagal dengan "Unrecognized token".

`test/import-convention.test.ts` menjaga ketiganya: tak ada spesifier lama tertinggal, `package.json`/`tsconfig.json` sejalan, nama direktori vendor tanpa `#`, `vendor:check` hijau, tak ada U+FFFD di berkas terlacak, dan tak ada BOM di berkas konfigurasi.

---

## 5. Gate CI (18 langkah)

Baru di V5:

```
Extreme — bash fuzz (5 seed × 3 round)
Extreme — shadow-git stress (1500 file, 8 sesi)
Extreme — MCP adversarial
Pack check (npm tarball)
```

Perintah lokal: `bun run extreme`, `bun run extreme:fuzz`, `bun run extreme:git`, `bun run extreme:mcp`, `bun run gate:pack`.

---

## Sisa yang masih belum dikerjakan

Jujur, ini yang **tidak** saya sentuh:

- **Coverage `cli/` masih ~49% lines**, `src/policy` 89%, `src/providers` 82%. Target V4 (`cli/` ≥60%, policy/providers ≥90%) belum tercapai.
- **Resolve-rate live belum diukur ulang.** Angka 0,59 dari audit awal sudah basi setelah lima fase perubahan. Butuh provider ber-API-key.
- **Endpoint OAuth belum dikonfirmasi** lewat login sungguhan — butuh interaksi browser.
- **OpenAI Responses API dan Gemini native API** belum ada; Gemini masih lewat shim `/v1beta/openai`.
- **Belum publish ke npm.** Tarball sudah terverifikasi bisa dipasang, tapi `npm publish` sendiri belum dijalankan (butuh kredensial dan keputusan rilis).
- **Repo-map masih regex** dan masih menyentuh cap 2.500 char — keputusan Fase 3.2 tidak berubah.
