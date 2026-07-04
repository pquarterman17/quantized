# Origin `.opju` container — worksheet data encoding (SOLVED via Rosetta specimens)

**Consolidated into [`../origin_project_format.md`](../origin_project_format.md)
on 2026-07-04** (plan item 20) — see:

- §3.3 "`.opju` (CPYUA) worksheet columns — the FPC codec" for the record
  framing, ZigZag segment grammar, and the canonical Burtscher FPC
  predictor/codec details (items 7, 8, 32),
- §4.2 "`.opju` windows section" for the column names/units/comments
  grammar (item 10),
- §6.2 "`.opju` figures" for both the specimen-form and real-corpus-form
  axis-record grammar, including the combined axis-scale byte (item 33).

The original reverse-engineering narrative — including the full historical
trail (the XOR-delta/PREV-PRED hypothesis, the nibble-`C` DFCM
intermediate step, and the probe-by-probe path to the FPC identification)
— is preserved in this file's git history — see
`git log --follow -- docs/origin_re/opju_container.md`.
