# Origin trial-window validation log (plan item 31)

Manual/COM checks that need a real Origin install; run whenever a license is
present. Origin 2026b trial window: ~2026-07-03 → early July 2026.

## 2026-07-04 (overnight run)

- **Ground-truth exports** — Origin itself exported worksheet CSVs + JSON
  indexes for the corpus (`specimens/ground_truth/`): all 5 `.opju` (Hc2 data
  repeatedly wedged the invisible instance — written off), `.opj` oracles for
  XRD/XMCD/+ (Moke in flight), all trial specimens. These power the oracle
  suite (`tests/test_io_origin_ground_truth.py`).
- **Codec probes** — `probe_c.opju`, `probe_dfcm.opju`, `probe_bits.opju`
  (+ truth JSONs) generated via COM with designed value patterns; proved the
  `.opju` codec is canonical Burtscher FPC and pinned its parameters (see
  `opju_container.md`).
- **`.opju` codec SOLVED (2026-07-04)** — the bit-flip probes localized the
  FPC hash key to the high mantissa/exponent bits; a joint oracle-fit across
  three XAS columns pinned the exact FCM/DFCM shifts + 2^12 table. `read_opju`
  now decodes worksheet columns bit-exact, verified by the ground-truth oracle
  suite (XAS 243/243; hundreds of columns across RockingCurve/UnpolPlots/Fixed
  Lambdas/Hc2). Residual gap: long near-constant-stride axis columns diverge on
  an exact DFCM collision detail and are dropped by the desync gate.
- **Writer Origin-compatibility — FAILED (2026-07-04):** a specimen `.opj`
  written by `writer.py` did NOT load in real Origin via COM `app.Load`
  ("Origin loads OUR .opj: False"). Our native `.opj` writer round-trips
  through our own reader only; real Origin rejects the file structure. The
  cross-platform export path (Origin-ASCII + `.ogs`) is unaffected and remains
  the recommended way to move quantized data into Origin. Fixing the native
  writer to satisfy Origin's loader is open follow-up work.

## How to re-run

`tools/origin_trial/export_ground_truth.py` (skips completed stems);
`tools/origin_trial/generate_specimens.py`. One COM script at a time; kill
zombie `Origin64.exe` before starting; never run two concurrently.
