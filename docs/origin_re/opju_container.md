# Origin `.opju` container — worksheet data encoding (SOLVED via Rosetta specimens)

Clean-room RE for `plans/ORIGIN_FILE_DECODE_PLAN.md` **items 7 + 8 + 10**.
Method: controlled specimens generated with an Origin 2026b trial via COM
(`tools/origin_trial/`), with known values/names, then byte-level analysis
anchored on those knowns. No GPL source consulted; no open `.opju` reader
exists — these findings are original.

**Status: SOLVED and shipping** (`src/quantized/io/origin_project/opju_codec.py`,
2026-07-04). The column codec is **canonical Burtscher FPC** (see the SOLVED
section below): two racing predictors + a per-value XOR residual, NOT the
XOR-delta / PREV-PRED scheme the early recon guessed. The reader decodes
worksheet columns bit-exact — validated against Origin's own ground-truth
export (XAS 243/243 values; RockingCurve/UnpolPlots/Fixed Lambdas/Hc2 —
hundreds of columns). Everything below the SOLVED section is the historical
RE trail (the PREV/PRED model was a special-case illusion — see "why the
early model looked right"), kept for provenance. Only preview/graph *images*
use zlib; worksheet columns never do.

**Item 10 (column names/units) also SOLVED and shipping**
(`src/quantized/io/origin_project/windows_opju.py`, 2026-07-04) — see the
"SOLVED — item 10" section immediately below. 151/151 long-names, 130/130
units, and 17/17 comments recovered across every decodable column in the
five-file oracle corpus (XAS, RockingCurve, UnpolPlots, "Fixed Lambdas SI",
plus the `rosetta_*` specimens).

## SOLVED — item 10: windows-section names/units (2026-07-04)

The CPYUA windows section is **not** `.opj`'s CPY block stream — it's a
separate tag/length framing that this work does not fully parse. What *is*
pinned (validated end-to-end through `read_origin_books`, not just in
isolation):

**1. Every worksheet column carries a 2-byte plot-designation marker,**
reusing `.opj`'s own marker-byte + display-code convention (see
`opj_windows_section.md` sec 4.1, offsets 0x25/0x26) inside CPYUA's framing:

| marker | designation |
|--------|-------------|
| `21 51` | X |
| `21 61` | Y |
| `30 61` | Y-error |

(`disregard`/`X-error` counterparts are unconfirmed — no oracle column
exercised them — so only these three are wired; anything else falls back to
plain `Y`, matching `.opj`'s own `_DESIGNATION.get(byte, "Y")` default.)

**2. A fixed-shape run of default column-format doubles follows every
marker**, then an OPTIONAL length-prefixed embedded blob
(`<len:u8><tag=0x01><bytes><NUL>`) holding that column's `ColumnInfo`/
`ImportFile` storage (present only for imported-file columns — a long
Windows path, some of it using what looks like Origin's internal string
back-reference shorthand, e.g. a literal `"` + `NUL` + a short binary run
standing in for a `>` — never decoded, just skipped over), then the REAL
label record in the **same** `<len:u8><tag:u8><text><NUL>` shape (`len`
counts tag + text + NUL). `text` splits on `\r\n` into
long_name/unit/comment (0-3 rows). A handful of concrete examples, from the
real corpus:

```
XAS.opju      @28536: 0c 0b "Energy\r\neV"                  (len=12, tag=0x0b)
XAS.opju      @29116: 1a 0b "Intensity\r\narb. units\r\nCo"  (multi-row + comment)
UnpolPlots    @214403+27: 03 02 "Q"                          (bare long-name, no \r\n at all)
rosetta_min   @2469:  0b 0a "Field\r\nOe"                    (the original head-start find)
SBook (2books)@4795+27: 02 01 ""                             (empty text = no label)
```

The `tag` byte is **not** meaningful for association (observed values
0x01/0x06/0x0a/0x0b/0x0c/0x0d/0x1a/0x43/0x62/… with no discernible per-column
scheme) — it is only ever used to detect "is this a real label" (reject
zero-length/known-internal-token text) vs skip.

**3. Every column emits its own marker (+ optional label) record, in true
sheet column order (A, B, C, ...) — INCLUDING columns that never decode as
worksheet data** (e.g. `RockingCurve.opju`'s `NbAl` book: only column A
decodes via `opju_codec.scan_columns`, but the windows section still emits
markers for B and C). This is why association is by **ordinal position**
within one book's *contiguous* marker run (mapped through standard
A/B/C/... lettering), not by parsing an internal short-name field — no such
field was pinned for CPYUA (`.opj` has one at property-block offset 0x12;
CPYUA's equivalent, if it exists, was not found).

**4. Each book's own marker run is anchored** via one of:

- the embedded `ColumnInfo`/`ImportFile` path's filename, alnum-stripped and
  matched against the book's known short name — handles Origin's habit of
  dropping underscores when deriving a book short name from an imported
  filename (`bl11_YIGPy_032.dat` -> book `bl11YIGPy032`); or
- a `<len=namelen+2> 00 00 <name>` window/book-header reference that appears
  even for books never imported from a file (manually-typed sheets, e.g. the
  `rosetta_*` specimens — `80 78 07 00 00 52 42 6f 6f 6b 91 0c` for `RBook`,
  where `07` = len("RBook") + 2).

**Positional guessing is not used to *detect* a label** — every accepted
record matches the exact `<len><tag><text><NUL>` byte count PLUS a
character-class + known-internal-token filter (rejects embedded blob
fragments like a truncated `ResultsLog`/`OriginStorage` token, which the
length-prefix match alone can land inside by coincidence). Association
across a book's columns *is* positional, but only after that book's
boundary is independently confirmed by anchor (a) or (b) above — never by
scanning the whole file for ASCII runs. When no anchor is found, or the
contiguous marker run doesn't cover every column `scan_columns` actually
decoded for that book, the book is left out of the result entirely (A/B/C
fallback stays in force) rather than guessed at.

**Corpus validation (2026-07-04), through the shipped `read_origin_books`,
counting only columns that decode as worksheet data (the item-8/32 decode
gap is orthogonal to this item):**

| file | names | units | comments |
|------|-------|-------|----------|
| XAS | 6/6 | 6/6 | 3/3 |
| RockingCurve | 8/8 | 8/8 | 3/3 |
| UnpolPlots | 23/23 | 2/2 | 1/1 |
| "Fixed Lambdas SI" | 108/108 | 108/108 | 10/10 |
| rosetta_min/lname/2books | 2/2 each | 2/2 each | — |
| **total** | **151/151** | **130/130** | **17/17** |

`Hc2 data.opju` (16 MB, 80 books, 1390 columns — the item-32 lock-in logger
file) has no consolidated `index.json` oracle, but runs clean (no crash, no
false positives) in ~2.3 s; only 9/1390 columns land a label there, which is
expected — most of that file's books are logger exports whose window
section didn't match either anchor pattern, so they correctly keep the A/B/C
fallback rather than being guessed at.

Implementation: `src/quantized/io/origin_project/windows_opju.py`, wired into
`opju.py`'s `_parse`/`_build_book` exactly the way `.opj`'s `window_metadata`
feeds its own `_build_book` (designation-X becomes the x axis; book display
titles recover from the embedded import filename where available).

## SOLVED — the codec is Burtscher FPC (2026-07-04)

Burtscher & Ratanaworabhan, *FPC: A High-Speed Compressor for Double-Precision
Floating-Point Data*, IEEE TC 2009. Per value, two predictors race:

- **FCM** (value predictor): `pred = fcm[fh]`
- **DFCM** (stride predictor): `pred = last + dfcm[dh]`

The encoder XORs the true float64 bits against the closer prediction and stores
the low `k` non-zero bytes (LE; dropped high bytes are the leading zeros). Each
value carries a 4-bit code; two codes pack into one control byte, **low nibble
first**:

- **bit 3** selects the predictor (`0` = FCM, `1` = DFCM),
- **bits 0-2** give the residual byte-count with the **canonical FPC bcode
  mapping**: codes 0-3 store 0-3 bytes; codes 4-7 store 5-8 (a leading-zero
  count of exactly 4 is unsupported, per the paper). Code 0 with either
  selector (`0x0`/`0x8`) is the predictor-exact, zero-byte case.

> **2026-07-04 width-rule correction.** The decoder first shipped with
> `(code & 7) + 1`, which *coincides* with the canonical mapping for codes
> ≥ 4 — the only codes clean ramps and messy instrument data ever emit — so
> hundreds of columns validated bit-exact while ultra-smooth data (codes
> 0-3: sub-3-byte residuals) misparsed. Every "DFCM-collision" divergence in
> the earlier notes below was a phantom-byte misalignment artifact of that
> width table; the predictor model itself was right all along. Fixed by the
> corpus census vs Origin's own dumps (61 → 6 missing columns).

Both hash tables hold **2^12 = 4096** entries (a *sweet spot* — bigger tables
decode strictly worse, because the collisions are load-bearing) and update the
textbook FPC way:

```
fh = ((fh << 6) ^ (value  >> 48)) & 0xFFF
dh = ((dh << 2) ^ (stride >> 40)) & 0xFFF
```

**How it was pinned:** designed probes localized the hash key to the high
mantissa/exponent bits (a bit-flip probe: flipping stride bits ≥50 changed the
slot, bits ≤48 didn't), then a joint oracle-fit across three XAS columns — each
stressing a different bit range — fixed the exact shifts/masks where any single
column left them underdetermined. This is why golden-parity RE needs *multiple*
known-content specimens, not one.

**Record framing — the ZigZag segment grammar (solved 2026-07-04):**
`0a 05 <varint> ff ff <nrows:varint> 00 <segment list> [0c <FPC stream>]`.
The field between `00` and `0c` — previously noted as a mysterious
"`2·nrows−1` size-ish field" — is a **ZigZag-varint segment list**
(`2·nrows−1` is exactly `zigzag(−nrows)`, the one-segment plain case):

- **negative −m** → m FPC-coded rows (from the `0c` stream);
- **positive +k** → k rows of one repeated value; a value-spec follows:
  `0x50` + float64, `0x1a` + the double's top 2 bytes (rest zero — round
  values like 1.0/5.0), or a bare `0x64` = 0.0.

Origin run-length-compresses constant runs *outside* the FPC stream: a
reflectivity total-reflection plateau becomes `[+11][0x50 1.00355…][−140]`,
an all-zero column `[+n][0x64]`, and a fully constant column is a single
repeat segment with **no stream at all** (the `1a`-literal "PConst" form
observed in the 4.3811 specimens is this same grammar). `0xff 0xff` also
occurs *inside* residual data, so the reader walks records with a cursor
that jumps past each decoded stream, and labels each record by the nearest
preceding `<Book>_<Col>` name.

**Known residual gap (plan item 32, narrowed):** the **chunked staircase
form** — records that interleave *multiple* repeat-runs and FPC streams
(`[+5][50 a][+4][50 b][−3][0c s1][50 b]…[0c s2]…`), seen in lock-in logger
columns (`Hc2 data` Theta/K/Q/R) and a few long theory/profile columns whose
plateau splits mid-record. Byte-level replay shows one *continuous* predictor
state across the chunks (stale strides from earlier segments produce
correction residuals inside later constant runs), but the per-chunk
repeat-count encoding is not yet pinned (a mid-record `50 <val> 0d`
reads as a plain count 13 where the opening segments are ZigZag). The
segment-sum gate rejects these records outright — dropped, never guessed.
6 corpus columns affected (of ~200 oracle-checked).

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

### Corpus findings (2026-07-04 overnight, v4.3380 files)

Validated against Origin-exported oracles (XAS energy column, 81 rows,
first values match byte-exact):

- **Unified width rule:** item width = ``(nibble & 7) + 1`` bytes for every
  nibble except ``8`` (0 bytes, predictor-exact). The 4.3811 specimen table
  ({7:8, E:7, F:8}) is a special case. Verified by unique whole-stream
  alignment on an 81-row stream using nibbles {5, 7, C, D}.
- **The size fields are varints:** the ``2·nrows−1`` marker is LEB128-style
  (81 rows → ``a1 01``). Record pattern to search:
  ``ff ff <nrows u16> <varint 2n−1> 0c``.
- Nibbles 5/7/D/E/F all decode as XOR-vs-PREV low-aligned residuals (44/81
  items of the XAS column verified value-exact against the oracle).
- **OPEN — nibble ``C`` (width 5):** 37/81 items. Payload is NOT the
  low-5 bytes of any tested residual (xor/sub × prev/prev2/2a−b/float-pred,
  bit-shifts 0–16, byte-reversal). The residual's missing 6th byte follows a
  ``(2^k−1)·4`` mask pattern (XOR borrow-runs), so C is a genuinely different
  sub-encoding (likely bit-packed significant-run coding). **Census: every
  real corpus column contains C items** → the decoder cannot ship for real
  files until C is cracked. Fastest path: a designed trial-COM probe (values
  engineered for 5–6-significant-byte residuals, e.g. microsteps like the
  XAS energy axis) giving known-residual↔payload pairs. UnpolPlots/Fixed
  Lambdas SI match no record pattern at all — further variants beyond C.

### SOLVED CONCEPTUALLY (2026-07-04, C-probe session): it's a DFCM codec

> **Superseded — now fully solved.** This section correctly identified the
> DFCM architecture; the exact FCM+DFCM parameters were pinned later the same
> night (see the "SOLVED — the codec is Burtscher FPC" section at the top).
> The text below is the intermediate reasoning, kept for provenance.

A designed COM probe (`specimens/probe_c.opju` + `probe_c_truth.json`,
generated by trial COM with known values) plus implied-predictor analysis on
the XAS oracle settles the architecture:

- **All delta nibbles store the XOR residual LE-low-aligned, width
  ``(n&7)+1``** — C is not special in encoding, only in *predictor*.
- **The predictor is DFCM-style (differential finite-context-method):** the
  implied predictor stride of each C item equals an *older actual stride*
  (XAS: item 28 uses stride₂₀, item 29 stride₂₁, item 33 stride₂₆, item 34
  stride₂₇; the first C item uses a round default). I.e. Origin keeps a hash
  table context → last-stride and predicts ``prev + table[hash(context)]``.
  Simple predictors (prev / 2a−b, either domain / lags / 3-term / stateful
  stride policies) were all eliminated; near-linear data (probe PC_A)
  *coincidentally* matches 2a−b because every table entry holds ≈ the same
  stride — which also explains every specimen "schedule" observation.
- Probe PC_B (ultra-smooth microsteps) engages further nibble kinds
  (0,1,2,3,4,6,9,A,B) with sub-byte-scale residuals — same architecture,
  shorter residuals — plus still-unexplained items: solve after the hash.

**Remaining to implement a decoder:** replicate the hash exactly — table
size, key (bits of the previous stride? two strides?), and the update rule.
Attack: use probe columns where strides repeat in controlled patterns
(design: stride sequence ABABAB / ABCABC with distinctive values) so each
table slot's key↔value pairing is directly observable. All offline once the
probes are generated (COM needed only for generation).

### The (superseded) open question: the PREV/PRED schedule

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
