# Origin trial-window validation log (plan item 31)

Manual/COM checks that need a real Origin install; run whenever a license is
present. Origin 2026b trial window: ~2026-07-03 → early July 2026.

## 2026-07-04 (overnight run)

- **Ground-truth exports** — Origin itself exported worksheet CSVs + JSON
  indexes for the corpus (`specimens/ground_truth/`): all 5 `.opju` (Hc2 data
  repeatedly wedged the invisible instance — written off), `.opj` oracles for
  XRD/XMCD/+ (Moke in flight), all trial specimens. These power the oracle
  suite (`tests/test_io_origin_ground_truth.py`).
- **Codec probes** — `probe_c.opju`, `probe_dfcm.opju` (+ truth JSONs)
  generated via COM with designed value patterns; proved the `.opju` codec is
  an FPC-style two-table XOR-delta compressor (see `opju_container.md`).
- **PENDING (needs a COM window):** load one of OUR written `.opj` files in
  real Origin and read values/names back via LabTalk — the writer's
  Origin-compatibility check. Until then the writer is validated only by
  round-trips through our own reader.
- **PENDING:** bit-flip probes for the FPC hash solve (task 23).

## How to re-run

`tools/origin_trial/export_ground_truth.py` (skips completed stems);
`tools/origin_trial/generate_specimens.py`. One COM script at a time; kill
zombie `Origin64.exe` before starting; never run two concurrently.
