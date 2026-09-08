# bench/docker — verifikasi SWE-Lite per-era Python

Skor 0/20 SWE-Lite terkonfoundasi lingkungan: pytest jalan di Python host
(3.14) sementara instance berasal dari era 2014–2023 (`cgi` hilang,
`collections.Mapping` dihapus, API pytest berubah). Direktori ini mem-pin
Python/pytest per instance agar angka comparable ke leaderboard.

## Isi

- `manifest.json` — 20 instance → `{python, pytest, runner, confidence}`.
  Tanggal era dari `base_commit` via GitHub API; versi Python = maks yang
  didukung repo saat itu (setup.py classifiers, diverifikasi per repo).
  `confidence: low` (requests 2014, sympy 2016) WAJIB divalidasi pada run
  docker pertama.
- `Dockerfile.py{36,37,38,39,310}` — image era (`minicode-swe:pyXX`).
- Runner: `bun bench/swebench.ts --docker` (verify di container; agen tetap
  di host). Tanpa daemon: gagal bersih dengan diagnosa `docker unavailable`.

## Pakai (butuh daemon Docker — TAK ADA di env Windows ini)

```bash
for f in bench/docker/Dockerfile.py*; do
  tag=$(basename $f | sed 's/Dockerfile.py//')
  docker build -f $f -t minicode-swe:py$tag bench/docker
done
bun bench/swebench.ts --docker --api-key-env K --base-url U --model M
```

## Batasan jujur

- Agen (bash tool) tetap jalan di host; hanya *skoring* (pytest) yang
  pindah ke container era. Instalasi dependensi repo (`pip install -e .`)
  diasumsikan sudah ditangani image/dokumen per repo bila gagal.
- Runner non-pytest (django `tests/runtests.py`) didukung via `runner`;
  sympy memakai pytest default dengan confidence low.
- Image BELUM pernah di-build (tanpa daemon) — manifest adalah data
  terverifikasi (tanggal + classifiers), Dockerfile belum tervalidasi.
