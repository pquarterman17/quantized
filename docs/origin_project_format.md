# Origin project format (`.opj` / `.opju`) — the authoritative reference

Single consolidated knowledge base for the clean-room Origin project reader
(`src/quantized/io/origin_project/`). This document supersedes the three
separate reverse-engineering reports formerly in `docs/origin_re/`
(`opj_windows_section.md`, `opj_figures.md`, `opju_container.md` — their
narrative history is preserved in git; each now carries a short pointer
here). `docs/origin_re/validation_log.md` remains a separate, live log of
real-Origin validation runs — it is not folded in here.

We do **not** use the GPL `liborigin` or the R package `Ropj` — this repo is
Apache-2.0 (`.claude/rules/architecture-guards.md` #3, #10). Published format
*facts* (byte layouts, OriginLab's own text-escape/plot-designation
documentation) are not copyrightable and may be cited; GPL *source code* is
never read into or copied by this implementation. All findings below come
from inspecting a private local corpus (`../test-data/origin/`, never
committed, never uploaded) and from Origin-generated ground truth (a 2026b
trial license + a persistent student license, via COM).

Where this document and the code disagree, **the code is truth** — RE
findings sometimes get refined after the report that first proposed them was
written (annotated inline below).

## Table of contents

1. [Status summary](#1-status-summary)
2. [Container family](#2-container-family)
3. [Worksheet data](#3-worksheet-data)
   - 3.1 [`.opj` (CPYA) worksheet columns](#31-opj-cpya-worksheet-columns)
   - 3.2 [Non-double column values (`.opj`)](#32-non-double-column-values-opj)
   - 3.3 [`.opju` (CPYUA) worksheet columns — the FPC codec](#33-opju-cpyua-worksheet-columns--the-fpc-codec)
   - 3.4 [Non-double column values (`.opju`) — report-sheet residue](#34-non-double-column-values-opju--report-sheet-residue)
4. [Windows-section metadata (names/units/designations)](#4-windows-section-metadata-namesunitsdesignations)
   - 4.1 [`.opj` windows section](#41-opj-windows-section)
   - 4.2 [`.opju` windows section](#42-opju-windows-section)
5. [Sheet hierarchy (`Book@N` pseudo-books)](#5-sheet-hierarchy-bookn-pseudo-books)
6. [Figures (graph windows)](#6-figures-graph-windows)
   - 6.1 [`.opj` figures — Graph → Layer → Curve](#61-opj-figures--graph--layer--curve)
   - 6.2 [`.opju` figures](#62-opju-figures)
     - 6.2.1 [Curve→column binding (item 35, `.opju` only, partial)](#621-curvecolumn-binding-item-35-opju-only-partial)
   - 6.3 [Origin → quantized figure mapping + gap list](#63-origin--quantized-figure-mapping--gap-list)
7. [Notes windows & results-log recovery](#7-notes-windows--results-log-recovery)
8. [Export: writing Origin projects](#8-export-writing-origin-projects)
9. [Testing & corpus](#9-testing--corpus)
10. [Clean-room provenance & references](#10-clean-room-provenance--references)
11. [Open items](#11-open-items)

See also: **[`docs/opening_origin_files.md`](opening_origin_files.md)** — the
short user-facing page ("what do I get when I import an Origin file").

---

## 1. Status summary

**`.opj` (CPYA):** worksheet data for every book and extra sheet (as
`Book@N` pseudo-books), real column names/units/designations, book display
titles, figures as plot-state snapshots, notes-window text, the results log,
import-all-books flow, and export (a native `.opj` writer + multi-book
`.ogs` scripts). Non-double column values are fully characterized: int/
float32 needed no work, the inline-text sentinel shape decodes
(`origin_text_columns`), and — as of this pass — the FitLinear/NLFit
auto-generated report-sheet reference-string family decodes too
(`origin_report_sheets`, §3.2), closing the item's "never garbage" AND
"decode the content" halves; only the fit's own *computed number* (not its
cell reference) stays unrecovered.

**`.opju` (CPYUA):** worksheet data decodes completely (canonical Burtscher
FPC codec, bit-exact vs. Origin's own ground-truth export — 210/210 oracle
columns). Column names/units/comments decode (151/151 names, 130/130 units,
17/17 comments across the oracle corpus). Figures decode via two record
shapes covering both synthetic-specimen graphs and real-corpus graphs
(14/14 real-corpus anchors + 6/6 specimen layers). Notes windows and the
results log are recovered the same way as `.opj` (one byte-level scanner
serves both containers). Report-sheet columns decode too (§3.4,
`origin_report_sheets`) via a different record grammar than `.opj`'s (a
`0x01` tag byte + ZigZag-varint string segments, not a wider fixed-width
record) — pinned against a new known-content oracle
(`specimens/fitreport2.opju`) and confirmed at scale against the real
`Hc2 data.opju` corpus file (1096 columns, 100% clean).

**Known, permanent gaps** (see [§11](#11-open-items) for detail): the
DataPlot curve→column selector (which exact columns a curve plots) is
undecoded in `.opj`; `.opju`'s IS decoded (§6.2.1) but a per-figure
attribution gap means restored figures still commonly resolve to a *book*,
not exact column pairs, in both containers. A native `.opj` writer
round-trips through our own reader but does **not** yet load in real Origin
(item 34, open); full sheet-hierarchy UI (nested Book→Sheet trees) is out
of scope by design — extra sheets surface as flat pseudo-books instead.
One still-undecoded non-double shape remains in each container: `.opj`'s
`Moke.opj Book3_A` mixes text labels and numeric-sentinel rows within one
column (§3.2, a different real-world worksheet-label family, not a
FitLinear/NLFit report); neither container recovers a report cell's actual
*computed value* (only which statistic it represents).

---

## 2. Container family

Every Origin project/template file begins with an ASCII magic + version
line:

| Ext | Magic | Meaning |
|-----|-------|---------|
| `.opj` | `CPYA 4.3380 188 W64 #` | project, **ANSI** strings |
| `.opju` | `CPYUA 4.3380 188` (also seen: `4.3227`, `4.3811`) | project, **Unicode** strings |
| `.otp` / `.otpu` | `CPYA` / `CPYUA` … | graph/analysis **templates** (same family; RE not yet extended here — plan item 21) |

**Key insight:** `.opju` is `CPYUA` — the Unicode sibling of the same `CPYA`
family, not an unrelated format. Both share the worksheet-data /
windows-section / figures conceptual layering below; the concrete framing
differs (see §3.1 vs §3.3, §4.1 vs §4.2).

### 2.1 `.opj` (CPYA) whole-file section layout

The entire file (after the header line) is a stream of size-framed blocks:

```
block = <uint32 size LE> <0x0A> <payload (size bytes)> <0x0A>
        (size==0 → a 5-byte spacer "00 00 00 00 0A", no payload, no trailer)
```

Implemented in `container.py::walk_blocks`. For `Moke.opj` (1,071,289
bytes), the regions are:

| Region | Byte range | Content |
|--------|-----------|---------|
| Header line | `0x00`–`0x15` | `CPYA 4.3380 188 W64 #\n` |
| File-header block | `0x16` | fixed 123-byte project header |
| **Datasets subsection** | `0x9c`–`0x20e73` | per-column *data* (§3.1) |
| **Windows subsection** | `0x20e7d`–`0x9d92c` | worksheet + graph window defs (§4.1, §6.1) |
| Framing break (`0x9d92c`, 60.2%) | — | trailing global storage begins |
| Trailing global storage | `0x9d92c`–EOF | `IMGEXP`/`AXISTYPE` export settings, plain-text `ResultsLog` (§7), a `GraphInfo` XML tree, project tree |

`walk_blocks` stops the moment the size-prefix framing breaks — evidenced by
a run of size-0 spacers giving way to an ASCII section tag where a size
would be:

```
0009d91c  0a 00 00 00 00 0a 00 00 00 00 0a 00 00 00 00 0a   ................
0009d92c  49 4d 47 45 58 50 0a 00 00 00 00 00 00 00 00 0a   IMGEXP..........
0009d93c  41 58 49 53 54 59 50 45 0a ...                    AXISTYPE.
```

(`walk_blocks` reads `49 4d 47 45` as a would-be size and finds the next
byte isn't `0x0A` → it returns cleanly.) That boundary separates
**datasets+windows** from **trailing storage** — worksheet windows and
*every* graph window sit before it, inside the one walkable stream
(datasets, windows, and figures are **not** separate sections; §4.1 and §6.1
share this same block stream). The trailing storage holds the results log
and analysis-log text (unreliable, free-text provenance — §7) but never the
structured window/figure definitions themselves.

### 2.2 `.opju` (CPYUA) container differences

`.opju` does **not** reuse `.opj`'s `<u32><0x0A>` block framing. After the
header line comes a `PrvwOPJU` preview preamble (a graph/preview bitmap,
zlib-compressed — `78 9c`/`78 da` streams, ~92 KB inflated; **worksheet
column data is never zlib-compressed**, only preview/graph images are), then
a separate tag/length framing this codebase does not fully parse as a
generic walker. Instead, each subsystem locates its own records directly in
the byte stream:

- **Worksheet data** — LEB128-varint-framed records, located by scanning for
  a `0a 05 <varint> ff ff` header (§3.3).
- **Windows-section metadata** — a 2-byte plot-designation marker per
  column, located directly (no generic block walk) (§4.2).
- **Figures** — a 4-byte anchor `03 00 00 1f` per graph layer, located
  directly (§6.2).
- **Notes windows / results log** — plain text, found by content shape
  alone (byte-level scan, not row/record framing) — the same scanner
  serves both containers (§7).

---

## 3. Worksheet data

### 3.1 `.opj` (CPYA) worksheet columns

Column data is stored as named datasets keyed `"<Book>_<Col>"` (e.g.
`Book1_A`, `Book1_B`, …; extra sheets get an `@N` suffix — §5). Each
dataset:

1. the name as a NUL-terminated string (`Book1_A\0`) inside a column-header
   block (147 bytes; per-column metadata: value type, count, mask, display
   — see §3.2 for what else lives here),
2. a data payload framed as `0x0A <uint32 size LE> 0x0A <payload>`,
3. payload = `size / 10` records, **10 bytes each**: an 8-byte
   little-endian `float64` value **+ a 2-byte per-cell flag** (Origin's cell
   mask/state) — `container.py::decode_doubles` slices columns `2:10` of
   each row rather than relying on numpy structured-dtype alignment.

Validated on `Moke.opj` `Book1_A`: `size = 1810 → 181 records`, decoding to
a clean symmetric field ramp −6796…+6746 Oe (the MOKE loop's field axis).
`stride = 8` yields garbage (the 2-byte flags misalign); `stride = 10` is
exact.

**Missing-value sentinel:** an empty numeric cell stores
`-1.23456789e-300` (bit pattern `0e 2c 13 1c fe 74 aa 81`,
`container.ORIGIN_MISSING`) — *not* flagged by the mask bytes. The decoder
maps it to NaN on decode (both `.opj` and `.opju`).

### 3.2 Non-double column values (`.opj`)

The 147-byte column-storage header does **not** carry a byte offset that
reliably distinguishes a double column from a non-double one — a full
per-offset diff of 1242 known-double vs. 58 known-text column headers in
`hc2convert.opj` found no offset where the two groups cleanly split (offset
`0x3d` is a useful *secondary corroborating* signal — see below — but does
not itself distinguish double from text). Decoding instead content-sniffs
the data block (`container.decode_inline_text`, `opj._looks_textual`):

- **Every worksheet cell is the same 10-byte `<u16 mask><8-byte value>`
  record regardless of the column's declared value type.** There is no
  narrower on-disk width for `int`/`float32` — a genuinely int- or
  float32-typed column's cells are still plain IEEE754 float64 bit patterns
  (e.g. `12.0`), so **int/float32 columns needed no code change at all**: a
  corpus-wide scan (`hc2convert`, `Moke`, `XRD`, `XMCD`,
  `MnN_Diffusion_PNR`, `SuperlatticeFits` — 2687 total column pairs) found
  zero data blocks at any stride other than 10 bytes/record.
- **"Text & Numeric" columns reuse the same 10-byte record**: the 8-byte
  value area holds a NUL-terminated ASCII/latin-1 string (up to 7 chars)
  followed by a `0x00`/`0x01` tag byte and zero padding, instead of a raw
  float64. Origin's own literal fit-failure sentinel is `"NaN"` (bytes
  `4e 61 4e 00 01 00 00 00`): pinned from `hc2convert.opj`'s 58
  Hc2-extraction columns (112,887 matching records, zero counter-examples
  across a 6-file scan). `decode_inline_text` decodes this shape; it wires
  into `metadata["origin_text_columns"]` — **never** `.values` (the data
  contract stays numeric).
- **A record with no NUL within its 8-byte value area is an unsafe
  overflow for `decode_inline_text`** — Origin's FitLinear/NLFit
  auto-generated "Notes"/"Summary"/ANOVA report-sheet columns (e.g.
  `hc2convert`'s `Book2_C@2`..`Book2_X@2`) embed variable-length reference
  strings like `"cell://Parameters.Slope.Value"` too long for the 8-byte
  value area. `decode_inline_text` returns `None` for the whole column the
  moment one record lacks an in-range NUL — but this family is **not** an
  honest drop anymore: see `decode_report_strings` below, a second, wider
  record shape that recovers it.
- **Report-sheet columns are a genuinely different, WIDER fixed record —
  solved (`container.decode_report_strings`).** Not a variant of the
  10-byte double/inline-text record: `<u16 mask=0x0001><NUL-terminated
  ASCII/latin-1 string><zero padding>`, where the **width is constant
  within one column** (Origin reserves it uniformly, sized to that
  column's longest cell — e.g. wide enough for
  `"cell://Notes.NumDerivParams"`) but **varies column to column** (21
  bytes up to 45+ bytes seen in the corpus). The `0x0001` mask (vs. plain
  data's/inline-text's `0x0000`) is the outright discriminator; the width
  itself is recovered from the block's own byte content (the spacing
  between consecutive `01 00` markers) and the whole block is
  re-validated at that width before being accepted, so a coincidental
  short match never survives past one row. Cells hold the same
  `cell://<Section>.<Row>.<Field>` reference-string family
  `decode_inline_text` already established the shape of (naming *which*
  fit statistic that cell represents: `Notes.*` metadata,
  `Input.R1/R2.C1..C4`, `Parameters.<param>.{Value,Error,tValue,Prob,
  Dependency}`, `RegStats.C1.*`, `Summary.R1.*`, `ANOVAs.*`, plus
  `embedding:FitLine`/`embedding:Residual` graph-embed references) — wired
  into `metadata["origin_report_sheets"]`, **never** `.values`/`.labels`.
  A sheet made entirely of report columns (e.g. a fit's own report table,
  `hc2convert`'s `Table3`/`Table15`/`Table17`) has zero plausible-numeric
  columns at all — still surfaced as its own empty-data pseudo-book
  (`opj._build_book`'s empty-`cols` branch) rather than being silently
  dropped for having nothing to put in `.values`.
- **What is still NOT recovered: the fit's actual computed number.**
  `cell://Parameters.Slope.Value` *names* the cell; the literal computed
  value (e.g. Slope = -1.5) was not found stored as a plain or
  FPC-compact-encoded float64 anywhere near these records in the `.opju`
  oracle that has known fit results (`specimens/fitreport2.opju` — see
  §3.4) — Origin appears to cache it in a separate internal structure
  neither decoder reads. This is now the item's only open sub-gap.
- **Secondary corroborating signal (header offset `0x3d`):** across every
  double AND text(`NaN`)-sentinel column in `hc2convert.opj`, header byte
  `0x3d` is `0x0a` (100%); every FitLinear/NLFit report-sheet column shows a
  different, varied value there. Flags "plain worksheet data column" vs.
  "auto-generated report construct" but does **not** distinguish
  double-from-text — not used by the implementation.

**Corpus census (real `.opj` files, all books):** `hc2convert.opj` 1242
double / 58 text(`NaN`) / 407 report-sheet (**all now recovered** — 0
still-dropped); `Moke.opj` 71/0/24 (report) + 1 still-dropped (a different,
undecoded shape — a worksheet column mixing multi-char text labels like
`"As deposited"`/`"325 °C"` with numeric-sentinel rows, not the report-sheet
family — see below); `XRD.opj` 17/0/0 (its 3 non-double columns are
unrelated name-regex false matches on sheet-header/graph blocks, not
worksheet columns at all); `XMCD.opj` 554/0/0 (1 still-dropped, same
false-match category); `MnN_Diffusion_PNR.opj` 179/0/12 (report) + 6
still-dropped (embedded-storage/sheet-header blocks, one large
`_Storage_Ebdded_pages_Data_` blob); `SuperlatticeFits.opj` 107/0/0 (5
still-dropped, all sheet-header/layer-storage false matches). Only
`hc2convert` has the inline-text sentinel pattern in this corpus; every
other file's non-double columns are either the report-sheet family (now
recovered) or content that was never a worksheet column to begin with (the
loose `NAME_RE` name-anchor incidentally matches a `Pd<SheetName>`-style
sheet header or an embedded-object reference; `_columns()` still calls
`decode_report_strings` on that payload, but its own internal validation —
the `01 00` mask stride check — correctly rejects it, so these were never a
risk of silent garbage, just an already-dropped, unrelated match).

**One genuinely different, still-undecoded family (`Moke.opj Book3_A`,
1 column):** a worksheet column mixing **short text labels** (`"As
deposited"`, `"325 °C"`) with **numeric sentinel rows** (the
`ORIGIN_MISSING` bit pattern) — i.e. varying record *type* row-to-row
within one column, not simply a wider *width* per column. Neither
`decode_inline_text` (7-char limit) nor `decode_report_strings` (uniform
mask+width per column) fits this shape; it stays an honest drop. This is a
real user worksheet's sample-condition label column, not a FitLinear/NLFit
report artifact, so it is out of this item's scope — noted here as an
open, separate residue for a future pass.

### 3.3 `.opju` (CPYUA) worksheet columns — the FPC codec

**Solved and shipping** (`opju_codec.py`). The codec is **canonical
Burtscher FPC** (Burtscher & Ratanaworabhan, *FPC: A High-Speed Compressor
for Double-Precision Floating-Point Data*, IEEE TC 2009) — NOT the
XOR-delta/PREV-PRED scheme the early recon guessed (kept below in
[§3.3.1](#331-historical-re-trail-why-the-early-model-looked-right) for
provenance). Validated bit-exact against Origin's own ground-truth export:
every `XAS.opju` column (243/243 values), hundreds of columns across
`RockingCurve`/`UnpolPlots`/`Fixed Lambdas SI`/`Hc2 data` — **210/210
oracle columns total**.

#### Record framing

Each column record: `0a 05 <varint> ff ff <nrows:varint> 00 <segment list>`.
`0xff 0xff` also occurs *inside* residual data, so `opju_codec.scan_columns`
walks candidate markers with a cursor that jumps past each decoded record's
own bytes, skipping the false in-stream hits. Every real record is labelled
by the nearest preceding length-prefixed `<Book>_<Col>` dataset name.

**Segment grammar (ZigZag varint):** the field between the row-count `00`
and the stream was originally misread as a mysterious "`2·nrows−1`
size-ish field" — it is a **ZigZag-varint segment list**
(`2·nrows−1` is exactly `zigzag(−nrows)`, the one-segment plain case):

- **negative −m** → m FPC-coded rows: `0x0c` + the stream follow *inline*,
  with a **fresh predictor state per stream**;
- **positive +k** → k rows of one repeated value; a value-spec tag
  follows: `0x50` + float64, `0x1a`/`0x11` + the double's top 2/1 bytes
  (rest zero — round values like 1.0/2.0/5.0), or bare `0x64` = 0.0.

Origin run-length-compresses constant runs *outside* the FPC stream: a
reflectivity total-reflection plateau becomes `[+11][0x50 1.00355…][−140]`,
an all-zero column `[+n][0x64]`, and a fully constant column is a single
repeat segment with **no stream at all**. **Segments interleave freely**
(logger columns alternate hold-runs and FPC bursts — the "chunked
staircase" generalization, item 32, closed): `[+5][50 a][+4][50 b][−3]
[0c s1][+13][50 b][−7][0c s2]…`, each FPC segment's stream sitting inline
right after its count, each stream starting with a fresh predictor state
(an earlier "continuous state" reading was a phantom-byte misalignment
artifact). Pinned by a truth-guided backtracking parser against Origin's
own CSV dumps (`RockingCurve Nb_B`, 937 integer counts; `Hc2
A6221Lockin4_D`, 1995 rows / 134 segments).

#### The FPC codec itself

Per value, two predictors race:

- **FCM** (value predictor): `pred = fcm[fh]`
- **DFCM** (stride predictor): `pred = last + dfcm[dh]`

The encoder XORs the true float64 bits against the closer prediction and
stores the low `k` non-zero bytes (LE; dropped high bytes are the leading
zeros). Each value carries a 4-bit code; two codes pack into one control
byte, **low nibble first**:

- **bit 3** selects the predictor (`0` = FCM, `1` = DFCM),
- **bits 0-2** give the residual byte-count with the **canonical FPC bcode
  mapping**: codes 0-3 store 0-3 bytes; codes 4-7 store 5-8 (a leading-zero
  count of exactly 4 is unsupported, per the paper). Code 0 with either
  selector (`0x0`/`0x8`) is the predictor-exact, zero-byte case.

> **2026-07-04 width-rule correction** (now reflected in `opju_codec.py`,
> supersedes an earlier draft of this doc): the decoder first shipped with
> `(code & 7) + 1`, which *coincides* with the canonical mapping for codes
> ≥ 4 — the only codes clean ramps and most instrument data ever emit — so
> hundreds of columns validated bit-exact while ultra-smooth data (codes
> 0-3: sub-3-byte residuals) misparsed. Every earlier "DFCM-collision"
> divergence was a phantom-byte misalignment artifact of that width table;
> the predictor model itself was right all along. Fixed by a corpus census
> vs. Origin's own dumps (61 → 6 missing columns, then to 0 after the
> segment-grammar fix below).

Both hash tables hold **2^12 = 4096 entries** (bigger tables decode
strictly worse — the collisions are load-bearing) and update the textbook
FPC way:

```
fh = ((fh << 6) ^ (value  >> 48)) & 0xFFF
dh = ((dh << 2) ^ (stride >> 40)) & 0xFFF
```

**How it was pinned:** designed bit-flip probes localized the hash key to
the high mantissa/exponent bits (flipping stride bits ≥50 changed the
slot, bits ≤48 didn't), then a joint oracle-fit across three XAS
columns — each stressing a different bit range — fixed the exact
shifts/masks where any single column left them underdetermined. This is
why cracking this codec needed *multiple* known-content specimens
(`tools/origin_trial/`), not one.

#### 3.3.1 Historical RE trail (why the early model looked right)

Kept for provenance — not how the shipped decoder works. The first working
hypothesis (an XOR-delta stream with PREV/PRED predictors selected by a
4-bit nibble code, `E`=7-byte residual, `F`=8-byte, `8`=predictor-exact,
`A`=2-byte truncated literal) decoded several specimen columns byte-exact
(ascending/descending integers, 0.1–0.8 messy mantissas, a geometric
column). It was a special-case illusion: near-linear/simple data
coincidentally matches a PREV/PRED schedule because the FPC DFCM table's
few active entries happen to hold ≈ the same stride. The "unified width
rule `(n&7)+1`" and the "nibble `C` is a DFCM stride-hash predictor" steps
were genuine intermediate progress toward the same conclusion the FPC
identification later confirmed outright (bit-flip probes against 2^12
hash tables). No code from this stage remains; it is preserved only so a
future RE session doesn't waste time re-deriving PREV/PRED and rediscover
it's a dead end for the general case.

### 3.4 Non-double column values (`.opju`) — report-sheet residue

**Solved and shipping** (`opju_reports.py::scan_report_columns`), the
`.opju` sibling of §3.2's `decode_report_strings`. Same conceptual content
(the FitLinear/NLFit auto-generated `cell://<Section>.<Row>.<Field>`
reference-string family) but a completely different on-disk shape — CPYUA
doesn't reuse `.opj`'s fixed-record framing anywhere, so this needed its own
grammar, pinned against `../test-data/origin/specimens/fitreport2.opju` (a
licensed-trial specimen with a KNOWN linear fit: x=1..8,
D=`[8.0,6.5,5.0,3.5,2.0,0.5,-1.0,-2.5]` ⇒ slope=-1.5, intercept=9.5; whose
`FitBook` has `Sheet1` (A,B) + the auto-generated report sheets `FitNL1` (28
columns, A..AB) + `FitNLCurve1` (11 columns, A..K) —
`tools/origin_trial/generate_specimens3.py`'s `fitreport2` case; ground
truth at `specimens/ground_truth/fitreport2/structure.json`).

**The grammar.** A report column shares `opju_codec`'s record header
exactly up through the row-count varint (`0a 05 <varint> ff ff
<varint>`) — but where a plain numeric column always has `0x00` right
after that second varint (`opju_codec._decode_record`'s own check), a
report column has **`0x01`** there instead. This is the outright
discriminator, checked at the exact byte position the numeric codec
already gates on, so the two decoders are mutually exclusive by
construction — `opju_reports.scan_report_columns` never intercepts a
record `opju_codec.scan_columns` would otherwise decode, and vice versa;
no cursor coordination between the two passes is needed. After the `0x01`
tag: a single ZigZag-varint segment count `n`. When `n` is **negative**
(`-m`), `m` consecutive `<len:u8><ASCII bytes>` strings follow (`len=0` is
a valid *blank* report cell — most report columns populate only a handful
of a sheet's rows). A **positive** `n` was observed on exactly 2 of
`FitNL1`'s 28 columns (its first two, "A" and "B", with no `cell://`
content at all) and its shape is not understood; those 2 columns are
honestly dropped, never guessed at.

**Book/sheet anchoring fix (shared with `opju_codec.scan_columns`).**
`fitreport2.opju` was the corpus's first `.opju` specimen with more than
one sheet inside a single book, and it exposed that `opju_codec._NAME` (the
dataset-name regex both `scan_columns` and `scan_report_columns` anchor
records to) lacked the `(?:@\d{1,2})?` sheet-suffix group `.opj`'s
`container.NAME_RE` already has. Every extra-sheet column was silently
mis-anchored to whichever **sheet-1** name came last before it (e.g. every
`FitNL1`/`FitNLCurve1` column collapsing onto `"FitBook_B"`) — not merely a
labelling cosmetic: `opj._group_named` groups columns by parsing the name's
`@N` suffix, so every mis-anchored column landed in the WRONG (or the
primary) pseudo-book, overwriting the previous one in the resulting dict.
Fixed by adding the same optional suffix group to `_NAME`; verified as a
pure fix (no matches change for any single-sheet file in the corpus, since
the added group is optional and every existing name lacks a literal `@`).

**Validation.** All 26 populated `FitNL1` columns decode to exactly the
reference strings `generate_specimens3.py`'s `fitreport2` case is known to
have produced (`Notes.*`, `Input.R1/R2.C1..C4`,
`Parameters.A/B/xintercept.{Value,Error,tValue,Prob,Dependency}`,
`RegStats.C1.*`, `Summary.R1.*`, `ANOVAs.*`); the 2 positive-segment columns
honestly drop. The real-corpus `Hc2 data.opju` (16 MB, 80 books — the
`.opju` sibling of `hc2convert.opj`, same Hc2-extraction naming) independently
confirms the grammar at scale: 1096 report columns, 2920 non-empty strings,
**100% `cell://`/`embedding:` prefixed** (zero garbage, zero validation
failures) — this file has no curated ground truth, so it is a soundness
check, not an exact-count anchor. `Fixed Lambdas SI`/`RockingCurve`/
`UnpolPlots`/`XAS.opju` (no fit-report sheets) all report zero report
columns — the grammar is not falsely triggering on ordinary worksheet data.

**Same open sub-gap as `.opj` (§3.2):** the fit's actual computed number
(e.g. Slope = -1.5, Intercept = 9.5) is not recoverable this way — checked
directly against `fitreport2.opju`'s byte range for both the raw and
FPC-top-N-byte-compact encodings of 9.5/-1.5, no match. The reference
string only names *which* statistic a report cell represents; Origin's
cache of the *value* lives somewhere this module does not decode.

---

## 4. Windows-section metadata (names/units/designations)

### 4.1 `.opj` windows section

`window_metadata()` (`windows.py`) walks the same block stream as §2.1,
past the datasets subsection.

**Window-header block** (`00 00 <BookShort> 00 …`, ≥150 bytes) opens each
worksheet or graph window:

- **Book short name** — NUL-terminated string at **payload offset 0x02**
  (`Book5`). Used for dataset naming (`Book5_A`).
- **Book long name (display title)** — a readable NUL-terminated run in the
  header tail, ending at the embedded-storage marker `@${[0|…]}`
  (`_book_long_name`). v4.3380 headers end the title at this
  `@${…}<OriginStorage>` marker; v4.3227 headers have no storage blob, so
  the title is the last printable run past offset `0x60`. Examples:
  Moke Book5 → `"Book2 - Copy"`; XRD Book1 → `"MD180412b_II_Theta2Theta.txt"`;
  XMCD → `"T106670001e"` (= short name when never renamed).
- **Discriminating worksheet vs. graph:** a worksheet window contains
  column-property blocks (below); a graph window does not (`figures.py`
  detects graphs via a following layer-continuation block instead — see
  §6.1). Version-robust structural test, not a template-name guess.

**Column-property block** (fixed size per file version: 519 B for v4.3380,
515 B for v4.3227) + **label-text block**, strictly alternating
(`[prop][label][prop][label]…`; a column with no label text simply omits
its label block — detect structurally, don't assume a fixed stride):

| Offset | Field | Notes |
|-------:|-------|-------|
| `0x00` | uint32 | column display width/size (variable — not a fixed marker) |
| `0x04` | byte | column **object id** (sequential per book); referenced by `0x23` of dependent columns |
| `0x06` | `0x0B` | **invariant** block-type tag — the primary detector anchor |
| `0x0b` | byte | flags (`0xa1` v4.3380 / `0x81` v4.3227) |
| **`0x11`** | **byte = plot designation** | 0=Y, 1=disregard, 2=Y-error, 3=X, 4=label, 5=Z, 6=X-error (Origin's published enum — see below). **Authoritative.** |
| **`0x12`** | **short name** | ASCII, NUL-terminated, variable length (1-4+ chars: `A`, `EY`, `c9`, `i0es`). Maps to the dataset — §4.1.1 |
| `0x23` | byte | X-column pointer: for Y/Y-error columns, the object-id (`0x04`) of the X column they plot against; `0x00` for X columns |
| `0x25` | `0x21` (`!`) normally | marker; **a Y-error column shows `0x30` here instead** (confirmed in `windows.py::_is_column_block`, refining the original report's "invariant `0x21`" claim) |
| `0x26` | byte | display code co-varying with designation (X→`0x51`, Y→`0x61`, disregard→`0x41`); redundant with `0x11`, not relied on |

**Robust column-block detector** (version-independent, `_is_column_block`):
`len ≥ 500 AND payload[0x06] == 0x0B AND payload[0x25] in (0x21, 0x30) AND
payload[0x12] is printable ASCII`. (Keying on `payload[0:4]==10 00 00 00`
fails — that's the width field, and it varies, e.g. XRD col B is
`10 01 00 00`.)

**Label-text block** — the column's label rows, `\r\n`-separated,
NUL-terminated: `LongName\r\nUnit\r\nComment[\r\n extra…]\0[@${…}]`. Split
on `\r\n`: index 0 = Long Name, 1 = Unit, 2 = Comment, 3+ = extra label rows
(user parameters, "Sparklines", etc.). Empty rows are preserved
(`\r\n\r\n` → empty Unit). Cut at `@${` before parsing (embedded
sparkline/object + `key="val"` label params may follow the NUL).
Non-ASCII bytes are Windows ANSI (latin-1): e.g. `325 \xb0C` = `325 °C`.

**Origin's published worksheet plot-designation enum** (format fact, not
GPL code):

| Value | Designation | Observed in corpus |
|------:|-------------|:--:|
| 0 | Y | yes |
| 1 | disregard / None | yes (FitLinear1 text columns) |
| 2 | Y Error | yes (FitLinear1 `Standard Error`/`Intercept` err) |
| 3 | X | yes (all `H`, `2Theta` columns) |
| 4 | Label | inferred (not present in corpus) |
| 5 | Z | inferred (not present in corpus) |
| 6 | X Error | inferred (not present in corpus) |

**Sheet (layer) structure.** Books can hold multiple sheets (`Moke.opj`
`Book4` has three: `Sheet1`, `FitLinear1`, `FitLinearCurve1`). Each sheet is
opened by a layer-header block (365 B v4.3380 / 361 B v4.3227, payload
`00 00 5e …`) followed by sheet-level storage/format blocks, then that
sheet's own column-property list. Sheet name sits at layer-header payload
offset ≈`0xCE`, format `… 50 64 <Name> 00` — the `50 64` ("Pd") 2-byte
prefix precedes every sheet name (`PdSheet1`, `PdFitLinear1`,
`PdFitLinearCurve1`); since auto-generated names like `FitLinear1` can't
have a user-typed `Pd` prefix, this is very likely a separate 2-byte field
(medium confidence — the field's own meaning is unpinned). Column-property
storage order is the sheet's *display* order, not necessarily A,B,C,… — map
by the short-name field (`0x12`), not position.

#### 4.1.1 Column ↔ dataset mapping rule (validated)

> For each worksheet window (book short name `B`), and each column-property
> block in the **primary sheet**, the short-name string `S` (offset `0x12`)
> identifies the dataset named `"<B>_<S>"`. The block's designation and its
> following label block (Long Name/Unit/Comment) attach to that dataset
> column.

Confirmed at scale on `XMCD.opj` (172 books): multi-char short names `EY`,
`c9`, `i0es`, `c13` join to real datasets `T106670001e_EY`/`_c9`/`_i0es`/
`_c13`. `windows.py::window_metadata` implements exactly this rule and
stops collecting once a repeated short name signals sheet 2+ has begun (see
§5 — full multi-sheet metadata is out of scope; only sheet-1 gets real
names/units).

### 4.2 `.opju` windows section

**Solved and shipping** (`windows_opju.py`). The CPYUA windows section is
*not* `.opj`'s CPY block stream — it's a separate tag/length framing this
module does not fully parse; what's pinned (validated end-to-end through
`read_origin_books`, across XAS/RockingCurve/UnpolPlots/"Fixed Lambdas SI" +
the `rosetta_*` specimens — **151/151 names, 130/130 units, 17/17
comments**):

**1. A 2-byte plot-designation marker per column**, reusing `.opj`'s own
marker-byte + display-code convention (§4.1 offsets `0x25`/`0x26`) inside
CPYUA's framing:

| marker | designation |
|--------|-------------|
| `21 51` | X |
| `21 61` | Y |
| `30 61` | Y-error |

(`disregard`/`X-error` counterparts unconfirmed — no oracle column
exercised them — so only these three are wired; anything else falls back
to plain `Y`, matching `.opj`'s own default.)

**2. A fixed-shape run of default column-format doubles follows every
marker**, then an OPTIONAL length-prefixed embedded blob
(`<len:u8><tag=0x01><bytes><NUL>`) holding that column's `ColumnInfo`/
`ImportFile` storage (present only for imported-file columns), then the
REAL label record in the **same** `<len:u8><tag:u8><text><NUL>` shape
(`len` counts tag+text+NUL). `text` splits on `\r\n` into
long_name/unit/comment (0-3 rows); a zero-length text means "no label"; a
bare long name with no `\r\n` at all is a valid single-row form. Examples
from the real corpus:

```
XAS.opju      @28536: 0c 0b "Energy\r\neV"                  (len=12, tag=0x0b)
XAS.opju      @29116: 1a 0b "Intensity\r\narb. units\r\nCo"  (multi-row + comment)
UnpolPlots    @214403+27: 03 02 "Q"                          (bare long-name, no \r\n)
rosetta_min   @2469:  0b 0a "Field\r\nOe"                    (original head-start find)
SBook (2books)@4795+27: 02 01 ""                             (empty text = no label)
```

The `tag` byte (observed 0x01/0x06/0x0a/0x0b/0x0c/0x0d/0x1a/0x43/0x62/…, no
discernible per-column scheme) is **not** meaningful for association — only
used to detect "is this a real label" vs. skip.

**3. Every column emits its own marker (+ optional label) record, in true
sheet column order (A, B, C, ...) — INCLUDING columns that never decode as
worksheet data** (e.g. `RockingCurve.opju`'s `NbAl` book: only column A
decodes via `opju_codec.scan_columns`, but the windows section still emits
markers for B and C). Association is therefore by **ordinal position**
within one book's *contiguous* marker run (mapped through standard A/B/C/…
lettering), not an internal short-name field — no such field was pinned for
CPYUA (`.opj` has one at property-block offset `0x12`; CPYUA's equivalent,
if it exists, was not found).

**4. Each book's own marker run is anchored** via one of:

- the embedded `ColumnInfo`/`ImportFile` path's filename, alnum-stripped
  and matched against the book's known short name (handles Origin dropping
  underscores when deriving a book short name from an imported filename,
  `bl11_YIGPy_032.dat` → book `bl11YIGPy032`); or
- a `<len=namelen+2> 00 00 <name>` window/book-header reference that
  appears even for books never imported from a file (e.g. `rosetta_*`
  specimens — `80 78 07 00 00 52 42 6f 6f 6b 91 0c` for `RBook`, where
  `07 = len("RBook") + 2`).

Positional guessing is **not** used to *detect* a label — every accepted
record matches the exact `<len><tag><text><NUL>` byte count PLUS a
character-class + known-internal-token filter (rejects embedded blob
fragments like a truncated `ResultsLog`/`OriginStorage` token). Association
across a book's columns *is* positional, but only after that book's
boundary is independently confirmed by anchor (a) or (b) — never by
scanning the whole file for ASCII runs. When no anchor is found, or the
marker run doesn't cover every column `scan_columns` actually decoded, the
book is left out of the metadata entirely (A/B/C fallback stays in force)
rather than guessed at.

**Corpus validation** (through the shipped `read_origin_books`, counting
only columns that decode as worksheet data):

| file | names | units | comments |
|------|-------|-------|----------|
| XAS | 6/6 | 6/6 | 3/3 |
| RockingCurve | 8/8 | 8/8 | 3/3 |
| UnpolPlots | 23/23 | 2/2 | 1/1 |
| "Fixed Lambdas SI" | 108/108 | 108/108 | 10/10 |
| rosetta_min/lname/2books | 2/2 each | 2/2 each | — |
| **total** | **151/151** | **130/130** | **17/17** |

`Hc2 data.opju` (16 MB, 80 books, 1390 columns) has no consolidated
`index.json` oracle but runs clean (no crash, no false positives) in
~2.3 s; only 9/1390 columns land a label there (expected — most of that
file's books are logger exports whose window section matches neither
anchor, so they correctly keep the A/B/C fallback).

---

## 5. Sheet hierarchy (`Book@N` pseudo-books)

Extra sheets (sheet index ≥ 2 within one book) are recovered as separate
pseudo-books rather than a nested Book→Sheet tree. The dataset-naming
convention already marks them: `"<Book>_<Col>@<N>"` (e.g. `Book4_A@3`).
`opj.py::_group_named` (shared by numeric and text column grouping) splits
on `@` and renames the pseudo-book `"<Book>@<N>"`; `_build_book` then gives
it a display title `"<Book long name> (sheet N)"`.

**Scope note:** only the **primary sheet** gets real names/units — the
windows-section column-property list for sheet 2+ is not consumed by
`window_metadata`/`opju_window_metadata` (see §4.1.1's "stop once a repeated
short name appears"), so extra-sheet pseudo-books fall back to the plain
Origin short designation (A, B, C, …) for labels. The `@N` suffix numbering
(sheet index vs. layer index; where sheet-2 vs. sheet-3 splits) is
validated for the common case but not exhaustively pinned — treat sheet-1
mapping as high confidence, extra-sheet *data* recovery as validated, and
extra-sheet *labels* as out of scope. Full Book→Sheet nesting in the UI was
a deliberate descope (frontend pseudo-books read `"Book@N (sheet N)"`).

---

## 6. Figures (graph windows)

### 6.1 `.opj` figures — Graph → Layer → Curve

`figures.py::extract_figures`. Graph windows live in the **same** block
stream as the worksheet datasets and windows (§2.1) — not a separate
section; `walk_blocks` already traverses them.

**Detecting a graph window:** a window-header block (`00 00 <Name> 00`,
shared detector with §4.1) is a *graph* header — as opposed to a worksheet
— when the immediately following block is a **layer-continuation block**
(head `00 00 1f 00`, ≥90 bytes holding the axis-range triples below).
Corpus counts: Moke 12, XRD 1, SuperlatticeFits 22, `SLD_DoubleY.otp` 1 (of
105 raw "Graph" token hits in Moke, only 12 are real window headers — the
rest are XML/notes references).

**Containment** (canonical layout, Moke `Graph3`, blocks 294–365):

```
GRAPH HEADER      "\0\0Graph3\0" + template token "LINE" + INI store
LAYER-CONT        axis ranges (X @15/23/31, Y @58/66/74)
obj hdr 0x23      "__LayerInfoStorage"
LAYER OBJECT      @${[0|5|_cart_object|...]} + AxesDlgSettings
axis tick-label text objects (×2, X and Y)
Y-axis TITLE      "%(?Y)" (auto)
X-axis TITLE      "%(?X)" (auto)
axis-config object (ticks/grid, __BCO2)
LEGEND            "\l(1) %(1)\r\n\l(2) %(2)\r\n\l(3) %(3)"
CURVE #1 (hdr 0x07 + 427-byte style + DataPlot record)
CURVE #2 …
```

**The 133-byte object header** is the universal graph-child-element
record. Byte at payload offset 2 is a type tag:

| type@2 | meaning | examples |
|-------:|---------|----------|
| `0x00` | text / axis-title / legend | `Text*`, `XB`,`XT`,`YL`,`YR`, `Legend` |
| `0x07` | curve / DataPlot | `_202`, `_232` |
| `0x22` | line/arrow annotation | `Line`, `Line1` |
| `0x23` | storage/config object | `__LayerInfoStorage`, `__BCO2` |

Object name is an ASCII run near offset ~64; two `float64`s at offsets 19
and 27 hold its position — axis-title objects carry it in **data
coordinates** (e.g. XRD `YL` @19=11.76, inside the log-Y range 0.5–1e8),
text annotations carry **normalized (0–1) layer coordinates** (XRD `Text2`
"Si (004)" @19=0.585). The data-vs-normalized selector flag is not located.

**Layer object** (`_cart_object`, a Cartesian coordinate system): a storage
block with `@${[0|<k>|<name>|<len>|<hash>]}` object-storage references
(name/payload-length/checksum) including `AxesDlgSettings` (axis-dialog
option bitfields — paired `{...},{...}` for two axes — but **not** the
numeric ranges) and `_Storage_Ebdded_pages_Data_` (embedded data-range
storage). **Double-Y = two overlaid `_cart_object` layers sharing the same
X range**, each with its own Y scale and curves — validated on
`SLD_DoubleY.otp` (two layer-continuation blocks, same X `(2950,3700,100)`,
Y `(-1.0,10.0,2.0)` vs. `(-0.5,2.5,0.5)`). Origin's general model allows N
free-positioned layers; double-Y and stacked panels are special cases.

**Axis range — validated.** The layer-continuation block stores each axis
as a `float64 (from, to, step)` triple at fixed offsets:

| axis | from | to | step |
|------|-----:|---:|-----:|
| X | @15 | @23 | @31 |
| Y | @58 | @66 | @74 |

Validated across 4 files / 37 graphs (Moke 12, XRD 1, SuperlatticeFits 22,
OTP 1+1 layers) without a single misparse:

| graph | X (from,to,step) | Y (from,to,step) | physics check |
|-------|-------------------|--------------------|----------------|
| Moke `Graph3` | (-7000, 7000, 2000) | (-1.25, 1.25, 0.5) | field-symmetric MOKE loop ✓ |
| XRD `Graph1` | (18, 100, 5) | (0.5, 1e8, 1.0) | 2θ range ✓, log intensity ✓ |
| SuperlatticeFits g1 | (0.03, 0.5, 0.1) | (0, 1.25, 1.0) | Q range (Å⁻¹) ✓ |
| SLD_DoubleY.otp | (2950, 3700, 100) | (-1, 10, 2) | template defaults |

**Y-scale type (lin/log) — solved 2026-07-04, exact.** The candidate flag
bytes tried right after each step (X @43, Y @86) never worked (value `0x08`
occurs for both log and linear across all 22 SuperlatticeFits graphs). The
real flag is 2 bytes at **payload offset 98/99**: `01 00` = linear, `08 01`
= log10 (`figures.py`'s `_y_scale_flag`). Isolated by byte-diffing XRD's
single log-Y `Graph1` layer-continuation block against all 15 recovered
linear-Y layers in `Moke.opj` — identical at every byte except 98/99 and a
second candidate at 189 that a wider scan ruled out as noise (mixed values
for both scale types). Validated against the *entire* `.opj` corpus (PNR,
MnN_Diffusion_PNR, XMCD, hc2convert, SuperlatticeFits, Moke, XRD): 111 log +
236 linear layers, **only these two byte values ever occur** — no third
state, no exceptions. Several instances are flag-log but
heuristic-linear (reflectivity R(Q) curves zoomed to a sub-decade log
range, e.g. Y=(0.977, 1.292), or Y=(3.29e-6, 2.09e-3) spanning under 3
decades) — cases the old heuristic got wrong that the flag resolves
correctly; `_y_scale_flag` is tried first and the decade heuristic is only
a fallback for the (so far unseen) unrecognized-byte-pair case. Same two
byte values, independently discovered via `.opju`'s real-corpus form (see
§6.2) — strong cross-container corroboration this is a real, dedicated
field rather than coincidence.

**X-scale type — still heuristic only.** No isolated X flag was found
anywhere near the layer-continuation block during this pass (the search
that found Y's flag did not surface an analogous one for X); an axis reads
as **log10** when `from > 0` and `to/from ≳ 10^3` with an integer `step`
(decade ticks) — correctly flags XRD intensity, SuperlatticeFits
reflectivity R(Q), and leaves MOKE/2θ linear. *(Note: `.opju`'s specimen
form separately isolated a combined X+Y scale byte via controlled trial
specimens — §6.2 — but Origin ≥2023 cannot write `.opj`, so no equivalent
specimen-based probe exists for CPYA to look for an analogous byte there;
X stays a documented gap.)* Confidence: range HIGH, Y-scale HIGH (exact),
X-scale MEDIUM (heuristic).

**Axis titles.** `type=0x00` objects named `XB`/`XT`/`YL`/`YR`. **Auto:**
`%(?X)`/`%(?Y)` — Origin builds the title from the plotted column's
long-name + units at render time (ties figure rendering to the
windows-section name recovery, §4.1). **Literal:** recovered verbatim,
e.g. `Intensity (arb. units)`, `2\g(q \(40))degrees)` → "2θ (°)". Origin
text escapes (public OriginLab syntax, cited as fact, not GPL source):

| escape | meaning |
|--------|---------|
| `\+(...)` | superscript |
| `\-(...)` | subscript |
| `\g(...)` | Greek/Symbol font (`\g(q)` = θ) |
| `\(NN)` | character by code |
| `%(?X)`, `%(?Y)`, `%(?Z)` | auto axis title from the X/Y/Z dataset |
| `%(n)`, `%(layer.plot)` | auto legend text for a curve |
| `\l(n)`, `\l(layer.plot)` | legend line/symbol sample for a curve |

**Legend.** A `type=0x00` object named `Legend`; one line per curve, e.g.
`\l(1) %(1)\r\n\l(2) %(2)\r\n\l(3) %(3)` (single-layer) or
`\l(1.1) %(1.1)  \l(2.1) %(2.1)  \l(2.2) %(2.2)` (multi-layer, `layer.plot`
indexing — the authoritative curve enumeration and the cleanest way to
count curves per layer). Entries can be hand-edited to literal text
(overriding the `%(n)` auto text) — seen as XRD sample-temperature labels.

**Curves (DataPlots).** A `type=0x07` object (auto-named `_NNN`) + a
427-byte style block + one or more **DataPlot records** ("X-blocks"),
recognizable by an 8-byte prefix + length field:

```
58 00 00 00  98 03 40 b3   af 02 00 00  06 00 00 00
af 02 00 00  03 00 00 00   ...
```

`0x58` marker byte, constant magic `0xB3400398`, then `<u32 bodyLen>`
(confirmed `size - bodyLen == 89` on every DataPlot across the corpus — so
the record is an **89-byte header + variable body**), a small enum
(6 in all curves seen — plot-type/style?), a repeated `bodyLen`, another
small enum (3 or 6 — color/axis?). **The column selector is inside the
undecoded body** (no ASCII, no plain indices found) — this is the
permanent curve→column-binding gap (§6.3, §11).

**How a curve references its dataset — what IS known:** workbook binding
is at the **layer level**, by display short-name (the layer-continuation
block names its source book once, e.g. Moke `Pd1` @~offset 208, XRD `Pd`)
— *not* the internal `BookN`; resolving `Pd1 → Book4/Book5` needs the book
short-name ↔ internal-name map from §4.1. Curve count/identity is
authoritative from the legend `\l()` list + the count of `type=0x07`
objects. *Which* columns of the book are X/Y is **not** decoded.

**Annotations.** Text (`type=0x00`, `Text`/`Text1`/`Text2` — e.g. XRD Bragg
peak labels `Si (004)`, `MnN (004)`) and line (`type=0x22`, e.g. XRD
vertical peak-position markers) objects; a 133-byte header (position
@19/@27) + format block + content. Axis grid/tick config (`__BCO2`, the
873/546-byte blocks) is unmapped (low import value).

### 6.2 `.opju` figures

**Solved and shipping** (`figures_opju.py::extract_figures_opju`). CPYUA
stores a graph layer's axis descriptor as a self-contained record, found by
scanning for the 4-byte marker `03 00 00 1f` (validated: opens every axis
record tested — controlled specimens *and* real corpus files, across both
CPYUA builds seen, `4.3380` and `4.3811`). **Two record forms exist, both
decoded:**

#### Specimen form (default-dialog graphs, item 14)

After the marker: X `(from, to)`, a step field, a fixed 8-byte marker
`81 04 06 00 00 01 c3 66`, then Y `(from, to)` + step. Values are a 2-byte
tag + 8-byte LE float64 literal, a bare literal, or a 2-byte tag + 1-3
significant bytes (the double's big-endian top-N bytes, stored reversed);
an exactly-zero `from` is elided entirely. The tag byte itself was never
cracked, so every admissible split of a value span is tried and accepted
only when exactly one split parses plausibly and consumes the span
exactly.

**The byte right after the `81 04 06 00 00 01 c3 66` marker is a combined
axis-scale flag** — this fact was pinned *after*, and is not present in,
the original item-11/item-14 RE reports; it lives only in
`figures_opju.py`'s module docstring and is reproduced here as the
authoritative version:

| byte | meaning |
|-----:|---------|
| `0x03` | X-lin, Y-lin (both linear) |
| `0x04` | X-log, Y-lin |
| `0x0d` | Y-log (**X is NOT encoded once Y is log** — the tempting additive guess "`0x0e` = both-log" was measured **false**) |

Pinned from four controlled single/dual-variable Origin-trial specimens
(`fig_lin`/`fig_log` toggling Y only, `fig_linx`/`fig_logx` toggling X
only, `fig_xylog` toggling both). **Y-scale is therefore always exact**
(`0x0d` ⟺ log, else linear); **X-scale is exact only in the Y-linear case**
(`0x04`) and otherwise falls back to the same decade heuristic `.opj` uses
(`fig_xylog`'s X honestly stays on the heuristic — a documented format
limitation, not a bug).

#### Real-corpus form (bound curves / non-default axis dialogs, item 33)

Real corpus graphs (the actual shape of every real `.opju` file in the
corpus, as opposed to the synthetic specimens above) don't share the
specimen form's fixed transition marker. Pinned against a 4-file
ground-truth oracle (RockingCurve, XAS, UnpolPlots, "Fixed Lambdas SI" —
14 anchors):

```
03 00 00 1f                       layer anchor
[optional flag token]             see length rule below
[X from] [X to] [X step]          value tokens; "from" ELIDED when 0.0
81 <id> <plen> 00 00 01 <geometry…>   separator; <id>/<plen> VARY
                                  (0x04/0x0d/0x10 …, plen 7/8/10/14 seen);
                                  plen is only a search-window HINT
[Y from] [Y to] [Y step]          value tokens (tagged/RLE only)
81 <id> <plen> 00 00 01 …         end separator (id 0x35 in 3 files, 0x04
                                  in "Fixed Lambdas SI")
```

**Value token encodings** (superset of the specimen form's):

1. **Tagged compact** `8T nn <nn bytes>` — tag byte `0x81..0x8f`, `nn` =
   payload length 1-8; payload reversed = the double's BE top-`nn`.
2. **Bare raw8** — 8 LE double bytes, no tag (never starts with a byte in
   `0x81..0x8f` in the corpus — used to reject flag positions).
3. **Bare compact** — 1-3 significant bytes with NO tag, right after a
   flag token (`f0 3f` = 1.0, `d0 3f` = 0.25).
4. **RLE-compressed raw8** — a byte-run inside the 8 LE double bytes
   collapses to a `c2`/`c3` escape. **Count law (solved by a
   constraint-fit across every `c2`/`c3` instance in all 4 files):
   `c2` = a run of exactly 5 repeated bytes, `c3` = exactly 6.** The byte
   after the repeated byte is a context/tag byte — NOT a count (01/02/03/0a
   observed for identical run structures) — and is skipped; literal suffix
   bytes then complete the 8. Two alignments:
   - lead form `<lead> c2/c3 <rep> <ctx> <suffix…>` — run covers double
     bytes 1..N (`9a c2 99 02 c9 3f` = 0.2; `9a c3 99 01 3f` = 0.025);
   - run-first form `c2/c3 <rep> <ctx> <suffix…>` — run covers bytes 0..N-1
     (`c3 66 03 f6 3f` = 1.4 — this also explains the `c3 66` inside the
     specimen form's transition marker: the same escape, repeating `0x66`).

**Flag tokens** (X span only, skipped via a deterministic length rule):
absent when the record opens with a tagged value; `89 01`/`89 18`/
`97 03`/`91 09` = 2 bytes; a bare `91` immediately followed by a run-first
RLE value = 1 byte. Semantics undecoded — across the oracle, every flagged
X axis is GT-linear, so the flags do **not** correlate with axis type. The
`85 02 f0 3f` sequence once suspected to be a y-log flag is in fact a
tagged `y_from = 1.0` (whole-span exact-fill + GT confirm), so **this form
has no isolated X-scale flag**: `x_log` falls back to the same decade
heuristic `.opj` uses — correct for all 14 corpus anchors (RockingCurve's
three log-Y layers span ≥5 decades; every linear layer spans <3), except
when the specimen-form's combined scale byte (§6.2's Specimen form,
`_scale_byte`) happens to also be present nearby — see the Y-scale flag
paragraph below for why this matters more than it first appears.

**Y-scale flag — solved 2026-07-04.** Unlike X, this form DOES carry an
isolated, exact Y flag, found via a new 4-file by-construction oracle:
`rf_linlin`/`rf_logx`/`rf_logy`/`rf_loglog.opju` — the SAME single-curve
graph with identical custom ranges `x=[0.2,20]`/`y=[50,2000]`, differing
ONLY in `layer.x.type`/`layer.y.type` (1=linear, 2=log10). The end
separator's geometry payload is followed by a fixed 4-byte layer-style
marker `00 10 10 00`; the 2 bytes immediately before it are the flag: `01
00` linear, `08 01` log10 — independent of the geometry payload's own
(variable) shape/length and of X's own type/encoding (which shifts the
marker's absolute position but never the flag's value or its relationship
to the marker). `opju_axis_real_form.py`'s `_real_y_log_flag`. Validated
exact against all 14 real-corpus anchors (RockingCurve's 3 log-Y layers
read `08 01`; XAS 3 + UnpolPlots 4 + "Fixed Lambdas SI" 4, all linear-Y,
read `01 00`) — the same two byte values, in the same order, as the
independently-discovered `.opj` flag (§6.1's `_y_scale_flag`, a different
fixed offset in a different container) — strong cross-container
corroboration this is a real, dedicated field.

Byte-diffing the oracle quad also surfaced a latent bug: all four
specimens carry the specimen-form's `81 04 06 00 00 01 c3 66`
Y-transition marker even though their X values use this form's RLE/tagged
encoding, so `_parse_specimen_record` was spuriously "succeeding" on the
two X-linear members (`rf_linlin`, `rf_logy`) with a **corrupted
`x_from`** (`0.19539186479597628` instead of `0.2`): a bare-raw8 candidate
in `_value_candidates` was accidentally decoding the leading `89 01`
flag-token + part of the RLE-encoded `x_from` as a plausible-looking
literal, and losing the real Y flag along with it (the specimen path's
`type_byte` only ever reflects X in this shape). Fixed with a guard
mirroring `_real_bare8`'s existing one: reject a bare (no-tag) raw8
candidate whose leading byte falls in the real-form flag range
`0x81..0x8f` — a genuine specimen-form literal never starts there. All
four oracle files, and `axis_custom.opju` (a fifth, independently
generated data point, byte-identical to `rf_logx` at the axis record),
now route through the real-form parser and decode `x_from` exactly.

**Span decoding is exact-fill**, mirroring the item-14 philosophy: X tries
`[from, to, step]` then `[to, step]` (from elided) after the flag skip; Y
(whose start position floats — `plen` is only a hint) scans forward for the
first position from which tagged/RLE tokens alone exactly fill the span.
Any arity whose fill set is non-unique is dropped, never guessed.

**Validation:** 14/14 real-corpus anchors match GT layers at 1e-9 rel with
correct lin/log (RockingCurve 3, XAS 3, UnpolPlots 4, "Fixed Lambdas SI"
4) — Y from the new exact flag, X from the decade heuristic; the 6
specimen layers (`fig_lin`/`fig_log`/`fig_pairs`) still decode via the
specimen-form path, and the rf_* quad + `axis_custom` (5 more files) decode
exact ranges with both X (via the specimen-form's scale byte, incidentally
present) and Y (via the new flag) exact. Composite windows (e.g. RockingCurve `Graph3`)
reference already-encoded layers, so anchor counts are fewer than GT
layers by design; a few derived graphs ("Fixed Lambdas SI" Graph5/Graph6,
including the corpus's only log-X layer) carry no `03 00 00 1f` record at
all and are honestly out of reach (no false coverage claimed).

**Curve/source resolution:** `source_hint` is filled from the
`<BKNAME>...</BKNAME>` OriginStorage XML tag when one appears near the
graph (unambiguous, low-false-positive — unlike blind name scanning); the
per-layer window name (Origin's "Graph1" etc.) is not recoverable, so
`name` is always `""` for `.opju` figures (unlike `.opj`, where the window
header supplies it directly). Unlike `.opj`, the DataPlot column selector
itself IS partially decoded — see §6.2.1.

#### 6.2.1 Curve→column binding (item 35, `.opju` only, partial)

`opju_curves.py::extract_curves`, wired into
`figures_opju.extract_figures_opju`'s `"curves"` field. Every curve
(`DataPlot`) object carries its own copy of the generic CPYUA "graph
object" header (`58 80 09 98 03 40 B3 <u32 bodyLen>` — the same shape
axis/legend/config objects use, so it isn't curve-exclusive and can't be
located by the magic bytes alone). Diffing `fig_pairs.opju` (one project,
4 graphs isolating the selector: A-B scatter / A-B scatter logY / **A-C
scatter** — the deliberate diff — / A-B line; see
`tools/origin_trial/generate_specimens.py`'s `fig_pairs` section — its
`plotxy iy:=` calls are the ground truth, since Origin's own GT exporter
has no oracle for this, see below) against itself isolated an 8-byte
per-curve token:

```
<flag:1> 01 <konst:1> 01 80 03 <y_ord:1> 00
```

`flag` is a per-curve creation-order/style counter (confirmed unrelated to
column choice). `y_ord` is a **1-based ordinal counted cumulatively across
every column of every workbook `opju_codec.scan_columns` actually decoded,
in book-appearance order** (a book with zero decodable columns — e.g. an
unused default "Book1" — doesn't participate in the count); it changed from
`0x02` to `0x03` in lockstep with fig_pairs' deliberate B→C swap, and only
then. `konst` — the position a naive by-symmetry read would expect an
X-column ordinal to occupy — was `0x01` in *every one* of ~44 samples
(specimen + full real corpus), including cases whose Y column belongs to a
different workbook than sibling curves in the same file; zero variation
means neither "X is always column A" nor "this byte is unrelated" can be
confirmed, so **X is not decoded** from the byte record at all. Instead the
shipped `"x"` is a structural inference: the Y column's own workbook's
first column (Origin's near-universal per-sheet X designation,
independently confirmed via §4.2's designation markers for every corpus
book checked).

**The real oracle (2026-07-04 rework).**
`tools/origin_trial/export_ground_truth.py`'s per-plot dump (`layer.nplots`
+ `range __rp = {pi}; ... __rp.name$`) came back **empty** (`"plots": []`)
for every project in this corpus — a LabTalk/COM issue in that trial-window
script. `tools/origin_trial/export_plot_refs.py` found a working recipe
instead (`range -w __rw = {pi}; "%(__rw)"`, probing `pi` upward), writing
`specimens/ground_truth/<stem>/plots.json` =
`{"<graph>": {"<layer>": ["[Book]Sheet!Col\"LongName\"", ...]}}` for every
stem including the real corpus (not just `fig_pairs`). This is the
strongest oracle available and is used file-wide (every `(book, column)`
pair a project plots anywhere) by
`tests/test_io_origin_figures_opju.py::test_realdata_curve_bindings_vs_plots_oracle`.

**False positive found and fixed — the `__BCO` boilerplate.** Against this
new oracle, `UnpolPlots` decoded two *wrong* pairs: `(PrNiO3STOprof, C)` and
`(PrNiO3STOrefl, C)` — neither book's column C is plotted at all (the real
bindings are `B` and `G`/`H`/`I`). Root cause: the whole-file regex scan
also matches the tail of a completely unrelated, fixed ~365-byte-long
per-book record that starts at a length-prefixed `__BCO2` string — one per
book, byte-identical across every book in every file checked (`XAS`,
`UnpolPlots`, `"Fixed Lambdas SI"`) apart from a few small varying
counter/row-count fields. This record's last 8 bytes always happen to fit
the curve-token shape and always resolve to **local column 3** ("C") of its
own book, regardless of what (if anything) is plotted there. It went
undetected before this oracle existed because every XAS book happens to
plot column C as its real curve (`Intensity`), making the artifact
"correct" by coincidence. `opju_curves._is_bco_boilerplate` now excludes a
match only when **both** hold: the resolved column is local index 2, *and*
a `__BCO` marker sits 340-380 bytes before the match (the exact span
measured across every confirmed instance is 357-360 bytes). Neither signal
alone is safe — `fig_pairs`' by-construction A-C diff curve also resolves
to local column 3, but at a ~1288-byte distance from any `__BCO` marker,
and must stay. This removes the 2 `UnpolPlots` false positives and,
necessarily, the 2 previously-"correct" `XAS` pairs, which were never
soundly decoded, only luckily right.

**Validation against the real oracle (file-wide `(book, column)` sets,
after the fix — see the module's docstring in `opju_curves.py` for the
byte-level trail):**

| stem | oracle pairs | decoded | correct | wrong | recall |
|------|-------------:|--------:|--------:|------:|-------:|
| `fig_pairs` (by-construction) | 2 | 2 | 2 | **0** | 100% |
| `curves_multi` (by-construction, new 2026-07-04) | 3 | 3 | 3 | **0** | 100% |
| `curves_2books` (by-construction, new 2026-07-04) | 2 | 2 | 2 | **0** | 100% |
| `XAS` | 3 | 0 | 0 | **0** | 0% |
| `RockingCurve` | 4 | 2 | 2 | **0** | 50% |
| `UnpolPlots` | 8 | 0 | 0 | **0** | 0% (was 2 wrong before the `__BCO` fix) |
| `"Fixed Lambdas SI"` | 14 | 2 | 2 | **0** | 14% |
| **aggregate** | **36** | **11** | **11** | **0** | **30.6%** (was 19.4% / 6/31 before the two new specimens) |

Precision is 100% on every oracle-covered file (mandatory, asserted
unconditionally; reconfirmed by the standalone scorer
`tools/origin_trial/score_curve_bindings.py`, run against the absolute
corpus path). Recall stays low and open on the real corpus — see the two
findings below.

**Two new controlled specimens (`curves_multi`, `curves_2books`, item 35
recall push, 2026-07-04) confirm the multi-curve/multi-book layout is
already solved correctly, with no code change.** `curves_multi` (one graph,
one layer, three curves — `MBook` B/C/D vs A) shows that multiple curves in
one layer are simply back-to-back, fully self-contained ~750-900-byte
per-curve objects, each with its own independent copy of the 8-byte token
(`y_ord` = `0x02`/`0x03`/`0x04`, strictly increasing, no wrapper/count
record). `curves_2books` (`BookOne!B` + `BookTwo!C`) confirms the
cumulative-ordinal base correctly carries a book boundary (`BookOne`'s 2
columns are counted before `BookTwo`'s 3 start at ordinal 3, exactly what
`_global_column_map` already computes). Both decode at 100%
precision/recall via the unmodified pipeline — see
`test_realdata_curves_multi_bindings` /
`test_realdata_curves_2books_bindings`. This raised the aggregate recall
from 6/31 (19.4%) to 11/36 (30.6%), but real-corpus recall itself did not
move — the investigation these specimens motivated (below) found a second
confirmed-excluded near-miss shape, not a new decodable signal.

**A second near-miss shape found and confirmed excluded — the per-book
"column candidate list."** Chasing why real-corpus recall stays far below
what `curves_multi`/`curves_2books` suggest turned up a decoy structurally
distinct from `__BCO`, found near *every* book reference in *every* file
checked (both new specimens included):

```
<flag:1> 01 <marker:1> 80 03 <ord:1> 00
```

One byte shorter than the real curve token — a single `0x01` (position 1)
straight into `80 03`, never the real token's double `0x01` (`.. 01 .. 01
80 03 ..`) — so `_CURVE_RE` structurally can never match it (confirmed by
direct inspection, not just by construction; regression-guarded by
`test_synthetic_column_enum_list_not_mistaken_for_curve_token`). It enumerates
every column of a referenced book in order (e.g. "Fixed Lambdas SI"'s
`PNRNbAu100nm` A→K, 11 entries). Its items were checked byte-for-byte for
any independent "this one is selected" marker (tail bytes compared across
several real-corpus runs) — none exists; items are shape-identical apart
from the running ordinal. The columns actually plotted always turn out to
be the run's *last* one to three entries, but that is a **corpus
convention** (derived "SA"/"dSA"/"Theory SA" columns are habitually
appended last), not a decodable structural signal — using "trust the tail
of the list" was considered and rejected as exactly the kind of guess this
decoder's precision-first design forbids.

**Known gap — per-figure attribution AND multi-curve recall (the reason
item 35 stays open).** Scoping a curve to *which* decoded figure it belongs
to is still a best-effort `[anchor, next_anchor)` byte-range heuristic, and
— now confirmed directly against the real oracle rather than inferred —
most of a real graph's curve tokens are simply not locatable yet: e.g.
"Fixed Lambdas SI"'s Graph1 genuinely plots 6 columns (`NbAl80nm`'s
I/J/K plus `NbAl100/120/200nm`'s K) but only 1 is recovered. Sharpened by
this rework: `RockingCurve`'s `Graph1` (`Nb!B`) and `Graph2` (`NbAl!B`), and
essentially all of XAS's and UnpolPlots's oracle-required curves, have
**neither** a real 8-byte token **nor** a column-candidate-list tail match
anywhere in the file — an exhaustive whole-file scan for both shapes
confirms zero candidates exist for them at all. These are ordinary,
single-curve, default-dialog graphs (unlike `NbAuRocking`'s custom-styled
multi-curve layer, or "Fixed Lambdas SI"'s "Theory SA" reference-overlay
curves, both of which DO carry the real token) — Origin evidently encodes
their column choice a third way, not yet located. This is a recall gap, not
a soundness one — everything reported is both designation-confirmed and
oracle-confirmed, never fabricated — but restored figures are still
commonly missing curves a user would expect. Closing it needs a further RE
pass specifically on simple/default single-curve graphs (not the
multi-curve/multi-book layout, which the two new specimens confirm is
already solved).

### 6.3 Origin → quantized figure mapping + gap list

Both readers emit a flat list of plot-state snapshot dicts (`name`,
`x_from`/`x_to`/`x_log`, `y_from`/`y_to`/`y_log`, `source_hint`,
`n_curves`, `annotations`) — shipped in the import payload
(`figures.extract_figures` / `figures_opju.extract_figures_opju`), surfaced
in the frontend's Library "Figures" section
(`frontend/src/components/Library/FiguresSection.tsx`). Resolving a
figure's `source_hint` to an actual imported dataset is a heuristic
(`lib/originFigures.resolveFigureDataset`); an unresolved figure shows
disabled with the hint in its tooltip rather than guessing.

**Proposed mapping** (design target for a richer FigureDoc entity, per
`ORIGIN_GAP_PLAN.md` #12 — partially realized by the shipped
plot-state-snapshot dicts above):

| Origin (recovered) | quantized target |
|--------------------|-------------------|
| Graph window name | figure name (`.opj` only — `.opju` has no recoverable name) |
| Layer (`_cart_object`) | one plot/panel |
| 2 layers, shared X, 2 Y ranges | dual-Y |
| Curve (`type 0x07` + DataPlot) | a plotted series |
| Layer source book short-name | resolved dataset (via `source_hint` heuristic); `.opju`'s curve token additionally gives exact `{book, x, y}` pairs where the per-figure attribution heuristic finds one (§6.2.1, partial) |
| X/Y range | axis limits |
| X/Y scale log | axis log flag (exact where solved, heuristic otherwise) |
| Axis title | axis label (Origin escapes stripped) |
| Legend | series labels / curve count |
| Text/line annotations | annotation list |

**Permanent gaps** (Origin features quantized cannot express / recover
yet):

- **Curve→column binding.** `.opj`'s DataPlot column selector is
  permanently undecoded — restored figures resolve to a *book*, not exact
  column pairs. `.opju`'s curve token IS decoded (§6.2.1) but per-figure
  *attribution* (which curve belongs to which decoded figure) is a lossy
  heuristic that drops most curves for composite/derived real-corpus
  graphs — so `.opju` figures commonly still restore to the whole book
  rather than each curve's specific X/Y pair, same as `.opj` in practice
  (plan item 35, open: no oracle exists to close the attribution gap).
- **Multi-layer free layout.** Origin allows N independently
  positioned/sized layers; quantized has single-plot + stacked panels +
  one inset. >2 layers or non-stacked overlays are lossy.
- **>2 Y axes / independent top-right axes** (`XT`,`YR` with own scales).
- **Rich text** (super/subscript, Greek, per-run font/color/size) — best
  effort via an escape→Unicode transform, dropping per-run styling.
- **Non-linear scales beyond log10** (probability, reciprocal, ln, log2,
  axis breaks) — not representable.
- **Per-curve fill-under, drop lines, split symbol edge/fill, connect
  style** (spline/step/B-spline) — partially or not modelled.
- **Arrow/box/region annotations with arrowheads** — quantized `refLines`
  are axis-parallel only.
- **X-scale type bit (both containers)** — still heuristic-only: the search
  that isolated Y's exact flag (below) did not surface an analogous X flag
  in either container. `.opj` additionally can't be probed with new
  specimens (Origin ≥2023 can't write it); see §6.1/§6.2.
- ~~**Y-scale type bit**~~ — **solved 2026-07-04** for both containers (no
  longer a gap): `.opj` payload offset 98/99 (§6.1) and `.opju`'s real-form
  Y flag before the `00 10 10 00` marker (§6.2) are both exact, `01 00`
  linear / `08 01` log10, validated against >300 layers corpus-wide.

---

## 7. Notes windows & results-log recovery

**Shipped** (`notes.py`; both containers share one byte-level scanner).

**Results log.** Origin's *results log* — the running record of every
analysis operation (fits, subtractions, smoothing) with parameters and
outputs — is plain text in both containers' windows/trailing-storage area,
shaped as timestamped records:

```
[5/6/2019 15:16:34 "" (2458609)]
subtract_line(subtract_line)
  Input
    iy(Input) = [Book4]Sheet1!(C"H",M)
    ...
```

`results_log()` collects printable runs (≥40 chars) containing at least one
timestamp-record header (`[D/D/YYYY H:MM:SS ...]`) — OriginStorage XML,
LabTalk scripts, and other internal text never match that shape, so
nothing is scraped speculatively. Lands in
`metadata['origin_results_log']`. This is fit *provenance*, not data — and
the *unreliable* source (contrast with the structured windows-section
metadata of §4, which is authoritative for names/units).

**Notes windows** (free-form user text pages) sit in the `.opju` (CPYUA)
windows section as a tight, contiguous pair of length-prefixed records:

```
93 <nl> <window-name> 00   0a <tl> <note-text> 00
```

— a `0x93` window-name record (`nl` counts name+NUL) whose NUL butts
directly against a `0x0a` text record (`tl` counts text+NUL). Validated
against a known-content specimen (`notes_probe.opju`, planted text
"QZNOTE line one/two"): the pattern recovers the exact two lines AND
matches **zero** records across the whole real corpus (none of which carry
a notes window), so it attaches nothing speculatively. Notes land in
`metadata['origin_notes']` as `{window_name: text}`. The scan is
byte-level, so it also runs over `.opj` (CPYA) — likewise
false-positive-clean on the corpus, but with no known-content oracle
(Origin 2023+ cannot write `.opj`, so no notes-window specimen can be
produced for it).

Both scans run once per file (`origin_project/__init__.py::_with_provenance`)
and ride only the primary dataset (and the first book of a multi-book
read) — they're project-global, not per-book.

---

## 8. Export: writing Origin projects

**Cross-platform path (recommended, always works):** `io/origin.py`'s
`format_origin_script` (single dataset) / `format_origin_project_script`
(multi-book) produce a CSV + a LabTalk `.ogs` script that rebuilds
designations, long names, units, and an optional graph when re-run inside
Origin. Route-exposed at `POST /api/export/origin` and
`POST /api/export/origin-project`. This path has no version dependency and
is MATLAB-parity tested.

**Native `.opj` writer** (`writer.py::opj_bytes`/`write_opj`, route
`POST /api/export/opj`): Origin ≥2023 dropped *writing* `.opj` but still
*reads* it, so a native CPYA writer reaches every Origin version — in
principle the highest-value export lever. It emits: header line + file-header
block; per column, a header block (`"<Book>_<Col>"`) + a 10-byte
`<mask><float64>` data block (NaN → `ORIGIN_MISSING`); then a windows
section per book (window-header block with short/long name, then per
column a 519-byte property block + a `LongName\r\nUnit\r\nComment` label
block) — mirroring §2.1/§4.1's layout exactly.

**Status: round-trips through our own reader (CI-tested) but does NOT yet
load in real Origin** (validated via COM `app.Load` during the 2026-07-04
trial window — `docs/origin_re/validation_log.md`). This is plan item 34,
open: the structural fields Origin's own loader may additionally require
(mandatory file-header fields, project-tree/root-window records, windows-
section completeness, or a trailer) are not yet identified. **Until this is
fixed, the `.opj` writer output should not be represented to users as
"opens in Origin"** — the LabTalk/CSV path above is the one that reliably
does. See `docs/opening_origin_files.md` for the user-facing framing.

---

## 9. Testing & corpus

Real Origin projects may hold private research data, so the source corpus
lives outside the repository entirely, at **`../test-data/origin/`**
(sibling directory, never committed, never pushed) — 17 real files (6
`.opj`, 5 `.opju`, 5 templates, 1 `.emf`) plus
`../test-data/origin/specimens/` (Origin-trial-generated Rosetta specimens
and `specimens/ground_truth/` — Origin's own CSV/JSON exports used as the
oracle). Tests that need this corpus carry `@pytest.mark.realdata` and
auto-skip when it's absent, so CI and other machines stay green
(`tests/test_io_origin_ground_truth.py`, `tests/test_io_origin_fuzz.py`,
`tests/test_io_origin_project.py`, `tests/test_io_origin_figures_opju.py`,
`tests/test_realdata_corpus.py`).

CI-safe coverage comes from synthetic CPY fixtures built in-test (zero
private data) plus a malformed-input/sweep/perf matrix (plan item 29) and
writer round-trip tests (item 30). Where possible, decoded values are
pinned as regression anchors against the real corpus (e.g.
`Moke.opj Book1_A` first point ≈ −6796.22 Oe).

---

## 10. Clean-room provenance & references

`liborigin` (GPL, SourceForge) and the R package `Ropj` are the prior
reverse-engineering efforts and a **format reference only** — their
existence and general claims (e.g. "Origin files use a block-based
container") were consulted as pointers, but no GPL source was read into or
copied by this implementation (Apache-2.0, `.claude/rules/architecture-
guards.md` #3). `.opju` had no prior open reader; every `.opju` finding
here is original, derived from local specimens and Origin's own
COM-generated ground truth.

Format *facts* cited as public vendor documentation, not GPL code: the
Origin worksheet plot-designation enumeration (Y, disregard, Y-Err, X,
Label, Z, X-Err) and the text-label/legend escape syntax (`%(?X)`, `\l()`,
`\g()`, `\+()`/`\-()`).

Burtscher, M. and Ratanaworabhan, P., *FPC: A High-Speed Compressor for
Double-Precision Floating-Point Data*, IEEE Transactions on Computers,
2009 — the published algorithm identified (not reverse-engineered) as the
`.opju` worksheet-column codec.

---

## 11. Open items

Tracked in `plans/ORIGIN_FILE_DECODE_PLAN.md`; summarized here for anyone
reading only this doc:

- **Item 34 — `.opj` writer real-Origin load failure.** Tier-1, open. See
  §8.
- **Item 35 — figure curve→dataset column binding.** `.opj`'s DataPlot
  column selector (§6.1) stays permanently undecoded. `.opju`'s IS decoded
  (§6.2.1, `opju_curves.py`) and shipped in `"curves"`, gated on an
  independently-validated column designation for precision. Reworked
  2026-07-04 against a real per-plot oracle (`plots.json`,
  `tools/origin_trial/export_plot_refs.py`): found and fixed a false
  positive (the `__BCO` per-book boilerplate, §6.2.1) that was misattributed
  as a curve on `UnpolPlots`; precision is now 100% on every oracle-covered
  file. Same day, two new controlled specimens (`curves_multi`,
  `curves_2books`) confirmed the multi-curve-per-layer and cross-book
  layout are already solved correctly (no code change), raising aggregate
  recall from 6/31 (19.4%) to 11/36 (30.6%); a second near-miss shape (the
  per-book "column candidate list", §6.2.1) was found and confirmed
  excluded along the way. Real-corpus recall itself stays low (0-50% per
  file, see §6.2.1's table) — per-figure *attribution*, and the still-
  undecoded third encoding used by simple single-curve real-corpus graphs,
  both remain open, so the item stays open.
- **Item 4 (report-sheet family) — non-double column values.** The
  FitLinear/NLFit auto-generated report-sheet text columns (§3.2) stay an
  honest drop; a materially harder variable-length RE problem.
- **Item 36 — Y-axis lin/log scale-flag byte (both containers), CLOSED
  2026-07-04.** Both `.opj` (§6.1, `figures.py`'s `_y_scale_flag`, payload
  offset 98/99) and `.opju`'s real-corpus form (§6.2,
  `opju_axis_real_form.py`'s `_real_y_log_flag`) now decode Y-scale exactly
  (`01 00` linear / `08 01` log10), validated against 14 real-corpus
  `.opju` anchors and >300 `.opj` layers corpus-wide. **X still has no
  isolated flag in either container** and stays on the decade heuristic —
  a documented, narrower remaining gap.
  file. Recall stays low (0-50% per file, see §6.2.1's table) — per-figure
  *attribution* and multi-curve-per-layer recovery both remain lossy, so
  the item stays open.
- **Item 4 (report-sheet family) — non-double column values.** CLOSED for
  the reference-string family: FitLinear/NLFit auto-generated report-sheet
  columns decode in both containers (`origin_report_sheets` — §3.2 for
  `.opj`'s `decode_report_strings`, §3.4 for `.opju`'s
  `opju_reports.scan_report_columns`). Two residues remain, both
  documented as separate, smaller gaps rather than reopening this item:
  (1) the fit's actual *computed number* (e.g. Slope = -1.5) is not
  recoverable — only the `cell://...` reference naming which statistic a
  cell represents; (2) one still-undecoded non-double shape,
  `Moke.opj Book3_A` (mixed text-label/numeric-sentinel rows within a
  single column — a different real-world worksheet family, not a
  FitLinear/NLFit report).
- **`.opj`/`.opju` scale-type bit** — permanently heuristic for `.opj` and
  for `.opju`'s real-corpus figure form (§6.1, §6.2); exact only for
  `.opju`'s synthetic specimen form.
- **Sheet-name exact bytes** (§4.1's `50 64` prefix) and **extra-sheet
  suffix numbering** (§5) — medium confidence, not exhaustively pinned.
- **Templates (`.otp`/`.otpu`)** — same CPY family, not yet RE'd as a
  quantized style-preset source (plan item 21).
- **Analysis-log structured parsing** — the results log (§7) ships as raw
  text; parsing its fit records into structured metadata is plan item 22.
