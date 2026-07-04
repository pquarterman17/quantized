# Origin `.opju` container — worksheet data encoding (cracked via Rosetta specimens)

Clean-room RE for `plans/ORIGIN_FILE_DECODE_PLAN.md` **item 7**. Findings only —
no production decoder yet (that's item 8). Method: controlled specimens
generated with an Origin 2026b trial via COM (`tools/origin_trial/`), with
known values/names, then byte-level analysis anchored on those knowns. No GPL
source consulted; no open `.opju` reader exists — these findings are original.

**Status: the column-data codec is substantially cracked.** The earlier recon
("no plain float64 anywhere → must be compressed") was right for the wrong
reason: worksheet columns are not deflate-compressed — they use a custom
**XOR-delta floating-point codec** (Gorilla-family) stored directly in the
container. Only preview/graph *images* use zlib. One codec detail (the
PREV/PRED mode schedule) remains open; everything else below is validated
byte-exact on specimens.

## Specimens (all local-only, `../test-data/origin/specimens/`)

`rosetta_min.opju` (3 806 B!): 1 book (RBook), col A = 1..8, col B =
111.125, 222.25, …, 888.0, long names Field/Moment, units Oe/emu.
`rosetta_lname.opju` (one long-name diff), `rosetta_2books.opju` (adds
SBook with 0.5·3ⁿ), `probe_seq.opju` (7 single-column books: ascending,
descending, geometric, constant, 2-row, 0.1–0.8 decimals, 1–16),
`fig_lin/fig_log/fig_pairs.opju` (graph diffs, unanalyzed),
`converted/*.opju` (corpus re-saved by 4.3811 — version pairs).
Trial writes `CPYUA 4.3811 222`; the corpus is 4.3380 — re-validate offsets
against corpus files before hardening the decoder.

## Where things sit in the file (rosetta_min, 3 806 B)

- `CPYUA 4.3811 222\n` header line, then tagged binary (`27 01 6c c0 …`) and a
  `PrvwOPJU` preview blob (@58).
- Column records carry their dataset name in ASCII: `RBook_A\0`-style
  (`RBook_A` @268, `RBook_B` @417) — same `<Book>_<Col>` convention as `.opj`.
- Label text ASCII near the tail: `Field\r\nOe`-shaped runs (@2471, @2539) —
  the `.opj` label-block format (LongName\r\nUnit\r\nComment) survives.
- A trailing string table repeats names (@3749+).
- The outer record framing is type-tagged (`80 xx` varint-ish, unlike `.opj`'s
  `<u32><0x0A>` blocks) and is NOT yet formally parsed — current probing
  locates records by scanning for the data-stream marker (below). Parsing the
  outer framing properly is decoder work (item 8).

## Column data record (validated byte-exact)

After per-column header bytes, the data stream sits at:

```
… 0a 05 20 | ff ff | <nrows u16 LE> | <mk> 0c | <codec stream> | ff ff | footer
```

- `<mk>` = `2·nrows − 1` in the cases seen (8 rows → `0f`, 16 rows → `1f`);
  treat as a field to read, not a constant.
- `0c` = format code for the XOR-delta codec. Two other forms observed:
  - **constant column** (PConst, 8×5.0): no `0c` stream; instead
    `10 | 1a | 14 40` — `1a`-tagged literal holding only the double's 2
    significant bytes (`40 14` BE → 5.0), rest implied zero.
  - **tiny column** (PTwo, 2 rows): per-value `00 00 | 1a | <2 sig bytes>`
    records (3.0 → `08 40`, 0.5 → `e0 3f`), no ctrl stream.
- footer: 4 bytes of per-column values in a `<a><01><2a><00>` shape
  (`18 01 30 00`, `10 01 20 00`, `1e 01 3c 00`, `20 01 40 00` — the third
  byte is always 2× the first; semantics unresolved) then `ce fa 00 00` —
  treat as opaque until item 8 maps it.

## The XOR-delta codec (the core finding)

Doubles are encoded as a **control-byte stream**: each control byte holds two
4-bit item codes, **low nibble first**; each code describes the next item:

| nibble | item | meaning (validated) |
|--------|------|---------------------|
| `7` | 8 bytes | literal float64 LE |
| `E` | 7 bytes | XOR residual, LE bytes 0–6, top (8th) byte implied `00` |
| `F` | 8 bytes | XOR residual, full 8 bytes (top byte ≠ 0) |
| `8` | 0 bytes | predictor hit exactly (residual = 0) |
| `A` | 2 bytes | truncated literal: the double's top 2 bytes, rest zero (seen in the `1a` constant/tiny forms) |

Values reconstruct as `u_i = P_i XOR residual`, where `u` = the float64 bit
pattern (u64) and `P_i` is one of two predictors:

- **PREV**: `P_i = u_{i-1}`
- **PRED**: `P_i = 2·u_{i-1} − u_{i-2}` (u64 wraparound arithmetic; a missing
  `u_{i-2}` is 0, so the second value's predictor is `2·u_1` — this is
  exactly what the observed `F` items match)

Validated end-to-end: the Y column (111.125…888.0) and the 0.1–0.8 column
decode **byte-exact** as literal + PREV-XOR residuals; the geometric column
(1,2,4,…,128 — arithmetic in bit-space) is literal + `F`(PRED) + six `8`s
(PRED exact each step); descending/ascending integer columns decode with a
mix of PREV and PRED residuals.

### The open question: the PREV/PRED schedule

Which predictor a given `E` item uses is deterministic but not yet derived.
Observed per-stream mode sequences (E-items in order):

- 0.1–0.8 (messy mantissas, like real data): **all PREV**
- ascending 1–8 / 1–16 (opened by an `F` item): PRED, PREV, PRED, PREV, …
  (with one tail anomaly at the 7th E-item of 1–16: PREV where alternation
  predicts PRED — and PRED's residual there is 0, so a scheduled-PRED encoder
  would have emitted `8`; it didn't)
- descending 8–1 (opened by two literals): PREV, PRED, PREV, PRED
- `8`-items always mean PRED-exact (proven by the geometric column, where
  PREV would need nonzero deltas)

Hypotheses eliminated: fixed slot (lo/hi) mapping, global alternation, value
-index parity, previous-item-type rules, greedy shortest-encoding (the
encoder demonstrably does NOT minimize bytes — it emits 7-byte PREV
residuals where PRED would give 0 bytes).

**Practical decoder plan (item 8):** real instrument data has messy
mantissas → PREV-dominant (the 0.1–0.8 pattern). Implement the codec with a
small per-column schedule search over {all-PREV, alternating-from-PREV,
alternating-from-PRED}, accept the first decode that (a) parses to exactly
`nrows` values and (b) validates against per-file oracles while we have them
(`specimens/ground_truth/` CSVs exported from Origin itself). Anomalies get
new probe columns via `tools/origin_trial/generate_specimens.py` while the
trial lasts.

## What this means for the corpus

The earlier probe that found "no plain float64 runs" in `XAS.opju` is now
explained: the energies are XOR-delta encoded (only each column's *first*
value appears as a raw double — and even it may be `F`/`A`-encoded). No
deflate hunting needed for data. Names (`bl11YIGPy033`-style books seen via
COM) are in ASCII in the container; labels ride the `.opj`-style
`\r\n`-separated label text.

## Also learned (tooling)

- Origin ≥ 2023 **cannot write `.opj`** — all trial specimens are CPYUA.
- COM: single `Origin.ApplicationSI` instance only — concurrent scripts spawn
  zombie instances and RPC faults (never run two COM tools at once); the
  collections iterator and `GetWorksheet` are broken via pywin32 — use
  LabTalk `doc -e` enumeration + `expASC` (see `tools/origin_trial/`).
