# Instalasi

Prasyarat tunggal: **`bun >= 1.0`**. Minicode memakai `bun:sqlite` langsung — tidak jalan di Node.js.

> Kernel MiniCore ikut repo di `vendor/minicore`, jadi **tanpa clone tambahan**. Klaim lama di `CONTRIBUTING.md` yang menyuruh clone `../minicore` sudah usang untuk pemakaian normal; clone sibling hanya dibutuhkan bila kamu mau sync ulang kernel via `bun run vendor:minicore`.

## Install

```bash
npm install -g @miniroom/minicode
# bin: minicode
```

Untuk kontributor (kerja dari source):

```bash
git clone https://github.com/startupmini/minicode && cd minicode
bun install && bun link
```

Opsional tapi disarankan: `rg` (ripgrep) di PATH mempercepat tool `grep`. Tanpa `rg`, walker internal dipakai dengan hasil identik (paksa jalur itu untuk uji dengan `MINICODE_GREP_ENGINE=js`).

Verifikasi:

```bash
minicode doctor        # runtime, provider, pricing, memory, sandbox, config
bun test               # offline/hermetic; live & docker di-skip otomatis
```

Setup wizard berjalan otomatis saat `minicode` pertama kali bila belum ada provider.

## Matriks OS

| OS | Sandbox otomatis | Default permission | Catatan |
|---|---|---|---|
| Linux + bubblewrap | Ya, tanpa flag | `auto` | Paling terisolasi untuk `bash` |
| macOS + seatbelt | Ya, tanpa flag | `auto` | Sama, via seatbelt |
| Windows (semua) / tanpa bwrap-seatbelt | Tidak tersedia | Turun ke `allowlist` + alasan dicetak sekali | Lebih baik membatasi perintah daripada label aman palsu. Pilih sendiri dengan `--allow-all` / `--ask`, matikan dengan `--sandbox none`, atau pakai `--sandbox docker` |

Docker **tidak** dipakai otomatis meski tersedia — menarik image tanpa diminta terlalu invasif untuk default.

## Update & uninstall

```bash
npm update -g @miniroom/minicode   # timpa paket, state user tidak tersentuh
minicode sync          # refresh model baru dari semua provider
minicode pricing sync  # refresh cache harga (3.162 model, ~213 KB)
```

Clone contributor: `cd minicode && git pull && bun install`.

Uninstall = `npm uninstall -g @miniroom/minicode` (atau hapus clone + `bun unlink` bila memakai link). Config global tetap di `~/.minicode/` sampai kamu hapus manual; config lokal di `.minicode/` per repo. Uninstall tidak pernah menghapus state, sesi, memori, atau file proyekmu.

## Lokasi data

- Config global `~/.minicode/config.json` + lokal `.minicode/config.json` (merge, lokal menang, tulis atomik + chmod 600).
- Token OAuth di `~/.minicode/auth.json` (chmod 600) — **bukan** di `config.json`, karena config lokal sering ikut ter-commit.
- Sessions `.minicode/sessions.db` (WAL), vector memory `vector.db`, repo-map `.minicode/repomap.json`, traces `.minicode/traces.jsonl`, checkpoint `.minicode/checkpoints/`, trash `.minicode/.trash/`.
- Override home untuk DB dengan `MINICODE_HOME` (berguna agar test hermetic di POSIX).

## Berikutnya

- [Quickstart 5 menit](quickstart.md) — wizard → prompt pertama → verify.
- [Troubleshooting](troubleshooting.md) — bila `doctor` merah atau sandbox tidak jalan.
