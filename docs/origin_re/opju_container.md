# Origin `.opju` container — worksheet data encoding (SOLVED via Rosetta specimens)

**Consolidated into [`../origin_project_format.md`](../origin_project_format.md)
on 2026-07-04** (plan item 20) — see:

- §3.3 "`.opju` (CPYUA) worksheet columns — the FPC codec" for the record
  framing, ZigZag segment grammar, and the canonical Burtscher FPC
  predictor/codec details (items 7, 8, 32),
- §3.5 "`.opju` (CPYUA) dataset records — the structural grammar" for the
  run-length-coded column header, the record framing and its length field,
  every storage class (Text&Numeric cells, double, float32, integers,
  complex, Text), the value-spec tag rule, the string heap and the used-row
  extent (2026-11-13; proven against third-party paired `.opj`/`.opju`
  specimens, no Origin install needed),
- §3.6 "`.opju` matrix books" for matrix shape and coordinate ranges,
- §4.2 "`.opju` windows section" for the column names/units/comments
  grammar (item 10),
- §6.2 "`.opju` figures" for both the specimen-form and real-corpus-form
  axis-record grammar, including the combined axis-scale byte (item 33).

The original reverse-engineering narrative — including the full historical
trail (the XOR-delta/PREV-PRED hypothesis, the nibble-`C` DFCM
intermediate step, and the probe-by-probe path to the FPC identification)
— is preserved in this file's git history — see
`git log --follow -- docs/origin_re/opju_container.md`.
