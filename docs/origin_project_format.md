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
     - 6.1.1 [Curve→column binding (item 11, `.opj`, solved)](#611-curvecolumn-binding-item-11-opj-solved)
   - 6.2 [`.opju` figures](#62-opju-figures)
     - 6.2.1 [Curve→column binding (item 35, `.opju` only, CLOSED)](#621-curvecolumn-binding-item-35-opju-only-closed)
   - 6.3 [Origin → quantized figure mapping + gap list](#63-origin--quantized-figure-mapping--gap-list)
   - 6.4 [Graph templates (`.otp`/`.otpu`) → quantized `GraphTemplate`](#64-graph-templates-otpotpu--quantized-graphtemplate-decode-plan-21-gap-ecosystem-item-5)
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
undecoded in `.opj`; `.opju`'s IS decoded, at 100% precision and 100%
oracle-covered recall (§6.2.1, item 35 CLOSED) — but a per-*figure*
attribution gap remains: which decoded figure a correctly-resolved
`(book, column)` pair gets attached to is still a best-effort heuristic, so
a curve can land on the wrong figure within a file even though the pair
itself is never wrong. A native `.opj` writer
DataPlot curve→column selector is now decoded in **both** containers — `.opj`
solved 2026-07-04 (§6.1.1, item 11: every curve's own global column id,
independently confirmed against that column's own workbook-storage block;
100% precision, 45/70 combined Moke+XRD refs, the rest structurally
unreachable) and `.opju` (§6.2.1, item 35: an 8-byte per-curve ordinal token,
100% precision; the 2026-07-05 global column-id-table rework (§6.2.2) then
raised `.opju` oracle-covered recall to 100% (36/36) and, via `0a`-framed
page-span scoping, closed the former per-figure attribution gap — only
`Graph5` (a duplicate-window graph carrying no binding token) remains a
documented negative. [Superseded note: earlier text in this section and §11
still quote the pre-rework 30.6% figure; §6.2.2 and `opju_figure_curves.py`
are authoritative. See `docs/origin_re/ORIGIN_CONVENTIONS.md` §6.1.] A native `.opj` writer
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
| `0x00` | text / axis-title / legend | `Text*`, `XB`,`XT`,`YL`,`YR`, `Legend`/`legend` |
| `0x06` | composite-layout axis-break sub-object | `OB`, `OL`, `OR`, `X1`, `X2` |
| `0x07` | curve / DataPlot | `_202`, `_232` |
| `0x22` | line/arrow annotation | `Line`, `Line1` |
| `0x23` | storage/config object | `__LayerInfoStorage`, `__BCO2` |
| `0x31` | filled region-shape object (decoded — see "Region-shape objects" below) | `Rect`, `Rect1`… |

Two further tag values are observed but uncharacterized (their objects are
skipped, never guessed): `0x21` (MnN_Diffusion_PNR, 23 instances) and
`0x10` (XMCD, 25 instances).

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

**Multi-layer figure emission — solved 2026-07-04 (item 36).** A graph
window is one figure to Origin's user but `extract_figures` previously
emitted only its FIRST layer (the layer-continuation block immediately
after the window header), silently dropping every additional layer's own
axis range and curves. Fixed: every layer-continuation block found inside
a window's span (from its header to the next window header, of either
kind) now yields its own figure dict, with a new 1-based `"layer"` key;
`"name"` repeats the window name across all its layers.

*Layer-record repetition — three head-byte values, not one.* The
layer-continuation block's 3rd payload byte is normally `0x1f` — every
window's first layer, AND every subsequent **overlaid** layer (a double-Y
graph's 2nd Y-axis on the *same* panel: validated on Moke's `Graph7`, both
layers `0x1f`, and independently on `SLD_DoubleY.otp`'s double-Y template,
also both `0x1f`). A second, much rarer value, `0x17`, marks a subsequent
**stacked/tiled-panel** layer (Origin's "N Panels" layout — a structurally
different multi-layer mechanism, a separate panel rather than an overlay
on the same axes) — isolated on Moke's `Graph4`: layer 1 head `0x1f`
`(0.9, 3.1, -50, 3000)`, layer 2 head `0x17` `(0.9, 3.1, 400, 1500)`, the
2nd layer's Y range matching the oracle exactly. A corpus-wide grep across
every local `.opj` (Moke, XRD, SuperlatticeFits, PNR, hc2convert, XMCD,
MnN_Diffusion_PNR) finds `0x17` nowhere except those 2 exact occurrences
(`Graph4` and its copy inside the composite `Graph10`) — never outside a
graph window's own span.

A THIRD value, `0x5f` (= `0x1f | 0x40`), marks **every** layer of an
Origin "Merge Graph Windows" result (decode-plan item 40, isolated
2026-07-09 on `PNR.opj`) — unlike `0x17`, which only ever appears as a
*subsequent* layer, `0x5f` appears as the FIRST post-header block too, so
before this was recognized the window-vs-worksheet gate in
`extract_figures` rejected these windows outright (their first
post-header block didn't look like a layer at all) and they produced
**zero** figures — the real-corpus gap behind `Graph30`-`Graph33`/
`PNRDWMerge`/`PNRmerge_Jan16` (6 graph windows, invisible end to end).
Confirmed genuine (not axis-shaped noise) two ways: the decoded axis
ranges are physically sane reflectivity ranges (Q 0-0.15/0.18, log R
1e-7/1e-10 to 2/10) and tile into a non-overlapping page-frame grid
(`opj_layer_frame`'s existing plausibility gate), AND the independent
`extract_curves` anchor scan resolves every merged layer's curves against
REAL, currently-imported books (e.g. `PNRDWMerge`'s 48 curves all bind to
`DW*` books; `Graph31`'s 18 curves all bind to `Book35`/`Book36`/
`Book37`) — not synthetic garbage. `_LAYER_HEAD_BYTES` now accepts
`{0x1f, 0x17, 0x5f}`; all three decode identically otherwise (same
axis-triple/hint/Y-scale-flag offsets). A merge window's `source_hint`
(the layer-continuation payload's cstring at offset 208) is NOT
meaningful — every merge window in the corpus reads the same stray `"Pd"`
(see §6.3's per-curve/source-hint gap note below), consistent with a
merge having no single "source book" of its own; the per-curve book
binding (§6.1.1) is what actually resolves each merged panel. `figures.py`'s
`_is_layer_block` accepts exactly `{0x1f, 0x17, 0x5f}` and nothing else —
a window's first layer is always one of these three (used to distinguish
a graph header from a worksheet header in the first place), so this
widening cannot affect that detection.

*Curve/text/annotation attribution — positional, validated exactly.*
Layer records and curve anchors are sequential within a window's block
span, so every curve anchor (§6.1.1), 133-byte curve-count object, and
annotation text between one layer-continuation block and the next belongs
to that layer; `n_curves`/`annotations` are scoped the same way. Validated
on Moke's three multi-layer windows, both layer count and the *exact*
per-layer `(book, column)` curve sets against `ground_truth/Moke/
index.json`:

| graph | layers | curves/layer | note |
|-------|-------:|--------------|------|
| `Graph4` | 2 | 2, 2 | stacked panels (`0x1f`, `0x17`) |
| `Graph7` | 2 | 3, 3 | double-Y overlay (`0x1f`, `0x1f`) |
| `Graph10` | 4 | 3, 3, 2, 2 | composite — literally `Graph7`'s 2 layers then `Graph4`'s 2, both source graphs' curves reproduced with no cross-layer bleed |

No fallback was needed — positional attribution matched the oracle
exactly once the `0x17` head byte was recognized as a real layer boundary
(the earlier failure was a layer-*detection* gap, not an attribution
failure); had it not matched, the documented fallback is to attach the
whole window's curves to layer 1 only, same as the pre-item-36 behavior,
rather than guess. Single-layer windows are unaffected — they still yield
exactly one figure dict, now carrying `"layer": 1`, byte-identical to the
pre-split decode otherwise. `.opju`'s `extract_figures_opju` (§6.2) already
emitted one dict per layer (its container has no window-grouping to
recover in the first place — see §6.2); it now also carries `"layer": 1`
as a constant on every dict, for shape parity with `.opj`, not a decoded
per-window index.

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

**X-scale type — still heuristic only in `.opj`.** No isolated X flag was
found anywhere near the layer-continuation block during this pass (the
search that found Y's flag did not surface an analogous one for X); an axis
reads as **log10** when `from > 0` and `to/from ≳ 10^3` with an integer
`step` (decade ticks) — correctly flags XRD intensity, SuperlatticeFits
reflectivity R(Q), and leaves MOKE/2θ linear. *(Note: `.opju` grew an EXACT
X flag on 2026-07-06 — §6.2, `_real_x_log_flag`, the same `01`/`08 01` byte
values as this container's Y flag — but the `.opj` corpus is all-linear in
X and the trial Origin cannot write `.opj` (a `.opj` save silently becomes
`.opju`, attempted 2026-07-06), so no oracle exists to isolate an `.opj`
twin from constants; X stays a documented `.opj` gap.)* Confidence: range
HIGH, Y-scale HIGH (exact), X-scale MEDIUM (heuristic).

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
| `\b(...)`, `\i(...)`, `\u(...)` | bold / italic / underline |
| `\f:Name(...)` | font |
| `\c<n>(...)` | numbered colour |
| `\(NN)` | character by decimal code (ANSI/Latin-1, e.g. `\(197)` = Å) |
| `\(xHHHH)` | character by hex code — Origin's Unicode escape (`.opj` Save-As form, e.g. `\(x2225)` = ∥) |
| `%(?X)`, `%(?Y)`, `%(?Z)` | auto axis title from the X/Y/Z dataset |
| `%(n)`, `%(layer.plot)` | auto legend text for a curve |
| `\l(n)`, `\l(layer.plot)` | legend line/symbol sample for a curve |

Decoded by `origin_richtext.clean_richtext` (2026-07-05, extended
2026-07-09) — a small recursive-descent renderer, not a regex table, so
nested runs resolve inside-out (`\g(\i(m))` → italic-of-nothing "m" →
Greek-mapped "μ", seen live in `Hc2 data.opju`'s
`\g(\i(m))\-(0)\i(H) (T)` x-title). Styling escapes (`\b`/`\i`/`\u`/
`\f:`/`\c<n>`) drop the formatting and keep the inner text — canvas
`fillText` can't style a substring, and content matters more than
markup. **Any run whose control code isn't recognized degrades the same
way** (keep the inner text, drop the wrapper) rather than raising or
leaking the raw escape — confirmed live on `MnN_Diffusion_PNR.opj`'s
`\ad(A)` (an undocumented 2-letter control, meaning not identified; degrades
to bare "A", matching the plain-"A" spelling used elsewhere in the same
project for the same unit — see the authoring-inconsistency note below).

Column Long Name / Unit / Comment (§4) and a book's own display title are
the *same* LabTalk label syntax as an axis title — Origin lets a user type
these escapes into a worksheet's column properties exactly as freely as
into a graph's axis title. Both containers decode them through this one
`clean_richtext` call, at `opj.py`'s `_build_book`/`_label_for`/
`_book_long_name`/`_inventory` (shared verbatim by `.opju` — the single
chokepoint feeds `.labels`, `.units`, `x_unit`/`x_column_unit`,
`x_column_long`, `origin_book_long`, and `column_comments`, i.e. every
frontend axis-label/legend/worksheet/Inspector consumer). Confirmed live:
`MnN_Diffusion_PNR.opj`'s "Nuclear SLD" books carry a column Unit of
`10\+(-6) A\+(-2)` — before 2026-07-09 this leaked the raw escape straight
into the frontend's `${label} (${unit})` axis/legend text composition
(`uplotOpts.ts`, `PlotLegend.tsx`, `clipboard.ts`) whenever a graph's own
axis title was blank (Origin's "Auto" title, which falls back to the
bound column's Long Name + Unit) — the likely source of the "raw escape
codes in the axis label" bug report that prompted this fix.

**Authoring inconsistency, not a decode bug:** the same
`MnN_Diffusion_PNR.opj` project spells "Å⁻¹" three different ways across
sibling books/columns for the identical physical unit — a literal ASCII
`A` (byte-hex confirmed: `0x41`, not `0xC5`) in most Nuclear-SLD units,
the proper `\(197)` char-code escape in a few, and plain unescaped text
(`"A-1"`, no backslash at all) in a couple of `Q`-column units. This is
the source file's own inconsistent hand-typing (or copy/paste drift)
across duplicated graphs, not a container/decode issue — the byte-level
evidence rules out a mis-decoded high-byte character (see git history for
the hex dump). Per the "samples are not standards" / "don't guess a
heuristic Graph25 already rejected" precedent, this is decoded faithfully
(whatever the project actually stored) and not "corrected" to Å.

**Legend.** A `type=0x00` object named `Legend`; one line per curve, e.g.
`\l(1) %(1)\r\n\l(2) %(2)\r\n\l(3) %(3)` (single-layer) or
`\l(1.1) %(1.1)  \l(2.1) %(2.1)  \l(2.2) %(2.2)` (multi-layer, `layer.plot`
indexing — the authoritative curve enumeration and the cleanest way to
count curves per layer). Entries can be hand-edited to literal text
(overriding the `%(n)` auto text) — seen as XRD sample-temperature labels.

**Composite (multi-layer) legends — decoded 2026-07-11 (decode-plan item
41).** Every multi-layer window in the corpus that captions several
layers' curves does it with ONE legend object that is (a) named lowercase
`legend` (20 instances across PNR/Moke/MnN_Diffusion_PNR/SLD_DoubleY.otp —
the exact-match `Legend` routing silently dropped them all) and (b)
written in the dotted `\l(layer.plot)` form. Both are now decoded: the
object-name match is case-insensitive, and `extract_figures` runs a
window-level pass (`figure_text.distribute_legend_layers`) that groups
dotted entries per layer, re-indexes same-layer auto templates to the
target layer's own curve ordinals (`%(2.1)` → `%(1)`, so the existing
per-figure `%(n)` resolver applies unchanged), and fills each layer dict's
empty `legend_labels` — never overwriting a plain-parsed one. Validated on
PNR.opj `Graph1` (layer 1 `["%(1)"]`, layer 2 `["%(1)".."%(4)"]`) and
Moke's `Graph4`/`Graph7`/`Graph10` (incl. hand-edited dotted entries,
"As-deposited"/"525"). Corpus impact: 49 figures gained legend labels, 19
gained a legend position (the lowercase objects' header fractions now
route to `legend_pos`); zero other field changes corpus-wide.

Two of those newly-decoded legend positions (Moke's stacked-panel `Graph4`
L1 and its `Graph10` L3 copy) exposed an **attach-unit mode**: the COM
oracle reports their `Legend.x1/y1` in LAYER FRACTIONS (x from the left, y
from the top), not data coords — the decoded data-coord point maps back to
the oracle fraction to 4-5 significant figures on both instances, i.e. the
same visual position in a different unit. The oracle comparison test
accepts either interpretation (`test_realdata_legend_positions_match_com_oracle`,
now 55 exact / 0 wrong / 0 missed).

**What `%(n)` resolves to — column Comment first.** Origin's auto legend
text for a curve substitutes the bound Y column's **Comment** when one is
set, falling back to the Long Name: PNR.opj `Graph1`'s rendered legend
(live-COM PNG oracle) reads "Nuclear SLD" / "700 mT" / "1.5 mT from
700mT" — all column Comments (`\A149` in the windows-section series
records; the Long Names are `rho`/`rhoM`). The frontend resolver follows
the same chain (comment → long name → short name).

**Region-shape objects (`Rect*`) — decoded 2026-07-11 (decode-plan item
41).** A filled rectangle dropped on a layer (the corpus uses them as
film-stack region bands — PNR.opj `Graph1`'s SiO2/Pt/YIG/Py/Ru/Air
vertical bands): a 133-byte object header with type tag **`0x31`** and
name `Rect`/`RectN`, followed by a **130-byte body** and a 1-byte
terminator. Body layout (`opj_shapes.py`):

| offset | field |
|-------:|-------|
| 7 | fill colour low byte (mirrors the u32 at 66 for palette fills) |
| 10 (f64) | left edge, layer-frame fraction (== header fraction @19) |
| 18 (f64) | top edge fraction, measured from the frame TOP |
| 26 (f64) | width fraction |
| 34 (f64) | height fraction |
| 66 (u32) | fill **ocolor**: high byte `0x00` = 0-based classic-palette index (same disk convention as curve colours), `0x01` = direct COLORREF `0x01BBGGRR` |

Corpus evidence: 329 instances across 4 files (PNR 156, SuperlatticeFits
151, MnN_Diffusion_PNR 16, SLD_DoubleY.otp 6) — every one named `Rect*`,
every body exactly 130 bytes, every fraction quad plausible; the width
fraction reproduces the header's page-unit box width / frame width exactly
(Graph1 `Rect5`: 207/4913 = 0.04213 = the offset-26 double). Fills
validated 6/6 against the live-Origin PNG oracle on `Graph1` (Ru=1 red,
Air/SiO2=0x12 light gray, Py=0x0b olive, YIG=3 blue, Pt=0x0e orange,
0-based); 29 corpus instances are direct-COLORREF (e.g. `0x012DAFE6` →
#E6AF2D). Shipped per layer as `region_shades: [{x1,x2,y1,y2,fill}]` in
data coordinates (`frac_to_data`, log axes in log10 space). **Honest
gaps:** no fill-transparency field could be isolated (all instances in any
one graph share whatever it is; no body byte reads like an alpha across
files) — render opacity is a documented frontend presentation choice; the
rare non-zero bytes at body offsets 49-65 (6 instances) and the 3-value
u16 at 114-115 are uncharacterized; no `Circle*`/other shape name exists
anywhere in the corpus, and no real `.opju` carries shape objects at all
(only the `SLDdouble.otpu` template twin) — the CPYUA framing of this
record is therefore not decoded (no real-corpus instance to validate
against).

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
small enum (3 or 6 — color/axis?). This first `type=0x07` + style +
DataPlot pair is a **fixed template**, always exactly 2 per layer
regardless of the real curve count (confirmed: Moke's `Graph2`/`Graph8`/
`Graph9`, 1 real curve each, and `Graph3`, 3 real curves, all show exactly
2) — its DataPlot body carries no column selector (no ASCII, no plain
indices found) and its purpose is not otherwise characterized here. The
**real, per-plotted-curve selector lives in a separate record** — see
§6.1.1, solved 2026-07-04.

**How a curve references its dataset — what IS known:** workbook binding
is at the **layer level**, by display short-name (the layer-continuation
block names its source book once, e.g. Moke `Pd1` @~offset 208, XRD `Pd`)
— *not* the internal `BookN`; resolving `Pd1 → Book4/Book5` needs the book
short-name ↔ internal-name map from §4.1. Curve count/identity is
authoritative from the legend `\l()` list + the count of `type=0x07`
objects (`figures.py`'s `n_curves`, unchanged by §6.1.1). *Which* columns
of the book are X/Y **is now decoded exactly** — see §6.1.1.

#### 6.1.1 Curve→column binding (item 11, `.opj`, solved 2026-07-04)

`opj_curves.py`, wired into `figures.extract_figures`'s `"curves"` field
(same `{"book", "x", "y"}` shape as `.opju`'s §6.2.1). Long presumed
*permanently* undecoded (the DataPlot body genuinely carries no selector,
per §6.1 above) — solved by looking one level up from the DataPlot, at a
previously un-investigated record immediately in front of it:

```
01 00 00 00  <id:u16 LE>  00 01 00 00  00 00 a1 00  ...
```

The first 6 bytes are the whole story: a fixed `01 00 00 00` marker, then a
little-endian `u16` that is the plotted column's own **global, project-wide,
monotonically-assigned serial id** — the same id independently stamped in
that column's own workbook-storage block (§4.1), at the identical offset
(4, u16 LE). **Book and column resolve together via this one id — there is
no separate book selector to find**, since ids are assigned once per column
across the whole project, never restarted per book.

**Detecting a real curve anchor** is content-based, not size-based: the
record's overall size is a per-file/build constant (519 B in `Moke.opj`,
515 B in `XRD.opj`) that carries no meaning, so the detector instead
requires the `01 00 00 00` marker to be *immediately followed* by a block
opening with the DataPlot magic itself (`58 00 00 00 98 03 40 b3`, the exact
bytes documented above) — this pairing is what a real curve looks like, and
nothing else in a graph window matches both halves at once.

**How this was found (the designed experiment).** Moke's `Graph8` and
`Graph9` both plot `[Book4]Sheet1!B` and have byte-identical block-size
sequences end to end. Diffing them block-by-block isolates pure *noise*:
every difference was a per-graph object/window creation-order serial
counter (a small, per-window-pair constant offset, e.g. always +7 between
these two windows — the same "creation-order counter, confirmed unrelated
to column choice" profile item 35 already documented for `.opju`'s `flag`
byte) or the window's own creation index (off by exactly 1 between
adjacent windows). Diffing `Graph8` against `Graph2` (same book, different
column `O`, same block-size alignment) with the same method isolates
exactly one block that is IDENTICAL between `Graph8`/`Graph9` (the noise
pair) but DIFFERENT between `Graph8`/`Graph2` (the signal pair): the
519-byte curve-anchor block. Its first differing byte looked, at first,
like a per-book column ordinal — Book2's `D`/`H`/`L` curves read 12/16/20
(exactly `letter_position + 8`) and Book3's `B`/`C`/`D`/`E` read 26/27/28/29
(exactly `letter_position + 24`) — but Book4 broke that model outright:
`B`=31, `H`=94, `O`=93, `M`=53, `N`=92, and no additive constant (letter
position or creation-order position) fits all five. The values were still
**unique per (book, column) pair** across all 15 pairs tested (8
independently-authored graphs, including `Graph7`/`Graph10` which each mix
`Book4` and `Book5` curves in one window) — exactly the profile of a real
per-column identifier, just not one derivable from position within its own
book. Cross-checking the same 16-bit value against each column's own
≥500-byte storage block in the windows section (located independently, via
that column's `"<Book>_<Col>\0"` dataset-name string — nothing to do with
any graph) found it verbatim at the identical relative offset — 5-for-5 on
the first pass, then every one of the 45 validated curves below.

**X is a structural inference**, exactly mirroring `.opju`'s §6.2.1: no
oracle (Moke's or XRD's `index.json`) records which column is plotted as X,
only the axis *range* — so `x` is inferred as the book's own designated-X
column (primary sheet, `windows.py`'s designation enum value `3`), falling
back to the sheet's first column when none is explicitly marked. This is
**not verified against any oracle**, here or in `.opju` — a documented
structural assumption, not a decoded value.

**Validation (2026-07-04, both required oracle files):**

| file | oracle refs | correct | wrong | recall | unreachable (why) |
|------|------------:|--------:|------:|-------:|--------------------|
| `Moke.opj` | 46 | 39 | **0** | 84.8% | `FitLine`/`Residual` (7 refs) — the FitLinear analysis's own auto-generated report graphs have no `00 00 <Name> 00` window header anywhere in the block stream (confirmed by an exhaustive string search); they live in the FitLinear analysis's own embedded storage |
| `XRD.opj` | 24 | 6 | **0** | 25.0% | 18 `sparkline*` refs — a structurally different feature (per-COLUMN inline mini-plots embedded in the worksheet, not separate Graph windows; no header, and a whole-file scan for the curve-anchor pattern finds exactly 6 hits total in the entire file, all inside `Graph1`) |
| **aggregate** | **70** | **45** | **0** | **64.3%** | two structurally distinct, out-of-scope window kinds, not undecoded curves |

Precision is **100%** on every reachable curve — every graph a
`00 00 <Name> 00` window header can locate at all decodes exactly, including
multi-curve (`Graph3`: 3 curves, Book2 `D`/`H`/`L`), multi-layer
(`Graph4`/`Graph10`: 2-4 layers), and cross-book-in-one-window
(`Graph7`/`Graph10`: `Book5` + `Book4` curves in the same window; XRD
`Graph1`: 6 curves across 6 different books) cases. The 25-ref shortfall is
entirely accounted for by two window kinds this decoder cannot see at all
(not curves it saw and mis-decoded) — a recall gap with a known, structural
cause, not an open decoding question. Precision/recall reproducible via
`tools/origin_trial/score_curve_bindings_opj.py` (a standalone rescorer,
sibling to `.opju`'s `score_curve_bindings.py`) and asserted by
`tests/test_io_origin_figures_opj_curves.py`.

**A pre-existing, unrelated bug surfaced along the way, not fixed here.**
`windows.window_metadata`'s column-block detector
(`windows._is_column_block`) requires `payload[0x06] == 0x0B`, which most of
`Moke.opj`'s `Book4`/`Book1` Sheet1 columns fail (they carry `0x09` there
instead — only a handful, e.g. `Book4`'s `H`, carry `0x0B`). Because so few
of Book4's real primary-sheet columns are ever "seen", the "sheet 2
restarted" guard that stops `window_metadata` from overwriting primary-sheet
data with a later sheet's never triggers for Book4 — so when its
`FitLinear1` report sheet's columns (which DO pass, since their header byte
is `0x0B`) come along, they get committed as if they were still primary-sheet
data, silently mislabeling `Book4`'s `A`-`G` designations/long-names with
`FitLinear1`'s instead. This is orthogonal to the id-based curve/column
decode above (`opj_curves.py` uses its own, more permissive column detector
and never calls into `windows.py`) and out of scope for item 11 — recorded
here as a discovered side-finding per the "surface it, fix deliberately,
never silently" porting principle, not patched in this pass.

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
(`0x0d` ⟺ log, else linear). **X-scale is exact too — solved 2026-07-06**,
but from the NEXT field, not this byte: the "`7b 40 01` filler" after the
type byte is really `7b 40` + a 2-value X-scale field, `01` = linear /
`08 01` = log10 (fig_log vs fig_xylog byte-diff; the same encoding the real
form carries before its Y span, `_real_x_log_flag`). That field is what
encodes X when the combined byte reads `0x0d` — both-log is `0x0d` + flag
`08 01`, closing what used to be a documented limitation (`fig_xylog`'s X
formerly fell to the decade heuristic). The byte's `0x03`/`0x04` X reading
remains as fallback corroboration for an unrecognized filler.

#### Real-corpus form (bound curves / non-default axis dialogs, item 33)

Real corpus graphs (the actual shape of every real `.opju` file in the
corpus, as opposed to the synthetic specimens above) don't share the
specimen form's fixed transition marker. Pinned against a 4-file
ground-truth oracle (RockingCurve, XAS, UnpolPlots, "Fixed Lambdas SI" —
14 anchors):

```
03 00 00 1f                       layer anchor (03 00 00 5f = 1f|0x40 for
                                  panel/composite multi-layer windows,
                                  2026-07-06; same grammar after it)
[optional flag token]             see length rule below
[X from] [X to] [X step]          value tokens; "from" ELIDED when 0.0
81 <id> <plen> 00 00 01 <geometry…>   separator; <id>/<plen> VARY
                                  (0x04/0x0d/0x10 …, plen 7/8/10/14 seen);
                                  plen is only a search-window HINT
[X-scale flag] [00-pads]          geometry TAIL: 01=lin / 08 01=log10,
                                  then 0-2 pad 00s (solved 2026-07-06)
[Y from] [Y to] [Y step]          value tokens (tagged/RLE; bare literals
                                  only via the flag-authenticated retry)
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
X axis is GT-linear, so these leading flags do **not** correlate with axis
type. (The `85 02 f0 3f` sequence once suspected to be a y-log flag is in
fact a tagged `y_from = 1.0`, whole-span exact-fill + GT confirm; the real
X-scale flag lives at the geometry TAIL instead — next paragraph.)

**X-scale flag — solved 2026-07-06.** The same rf_* by-construction quad
(below), byte-diffed pairwise on the X toggle (`rf_logx` vs `rf_linlin`,
`rf_loglog` vs `rf_logy`): the first separator's geometry payload ENDS with
an X-scale field right before the Y span's first token — `01` = linear,
`08 01` = log10 (the Y flag's own byte values), followed by 0-2 pad `00`s
whose count varies with the Y token encoding. `opju_axis_real_form.py`'s
`_real_x_log_flag` reads it backward from the decoded Y-span start; an
unrecognized tail returns `None` → decade heuristic (never guessed).
Corpus proof: all 9 by-construction specimens exact (rf quad,
fig_linx/logx/xylog, axis_custom); the corpus' one REAL log-x graph,
"Fixed Lambdas SI" `Graph6` (2 panel layers, GT `layer.x.type=2`, a 3.8x
span the decade heuristic mislabels linear) reads `08 01`; every GT-linear
real record (~70 across Hc2/RockingCurve/XAS/UnpolPlots/Fixed Lambdas)
reads `01`; zero false positives. Six Hc2 records read `02` — unrecognized,
heuristic kept. The specimen form carries the SAME field as the tail of its
"`7b 40 01` filler" (§6.2's Specimen form).

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

**Validation:** all real-corpus anchors match GT layers at 1e-9 rel with
correct lin/log — the original 14 `1f` anchors (RockingCurve 3, XAS 3,
UnpolPlots 4, "Fixed Lambdas SI" 4) plus, since 2026-07-06, the `5f`
panel-layer anchors (RockingCurve `Graph3` 3, UnpolPlots `Graph3` 4,
"Fixed Lambdas SI" `Graph5`/`Graph6` 2+2 — `Graph6` being the corpus' only
REAL log-x graph, x exact from the flag where the heuristic would mislabel
it linear). Fixed Lambdas' panel layers encode Y as bare literals: decoded
via a last-resort bare retry accepted only where the X-flag bytes
authenticate the Y-span start (a `y_start` pointing at a pad `00` is
rejected — letting a bare literal absorb the pads mis-decoded Graph5 L2's
`y_from` as -0.0488.. for -0.05 during development; measured, fixed,
regression-tested). The 6 specimen layers (`fig_lin`/`fig_log`/
`fig_pairs`) still decode via the specimen-form path, and the rf_* quad +
`axis_custom` (5 more files) decode exact ranges with both X and Y exact
from the flags. The same retry also surfaced 4 additional Hc2 records
(`Graph19` + 3 report-embedded graphs) absent from the page-limit-truncated
Hc2 GT capture — their bound-curve data brackets the decoded ranges
(internally consistent), but they are honestly unverifiable against GT.

**Curve/source resolution:** `source_hint` is filled from the
`<BKNAME>...</BKNAME>` OriginStorage XML tag when one appears near the
graph (unambiguous, low-false-positive — unlike blind name scanning); the
per-layer window name (Origin's "Graph1" etc.) is not recoverable, so
`name` is always `""` for `.opju` figures (unlike `.opj`, where the window
header supplies it directly). Unlike `.opj`, the DataPlot column selector
itself IS partially decoded — see §6.2.1.

#### 6.2.1 Curve→column binding (item 35, `.opju` only, CLOSED)

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

**Known gap at the time — per-figure attribution AND multi-curve recall.**
Scoping a curve to *which* decoded figure it belongs to was, and remains, a
best-effort `[anchor, next_anchor)` byte-range heuristic (unchanged by the
work below — see "Remaining gap" at the end of this section). But the
*recall* half of this gap — most of a real graph's curve tokens being
simply unlocatable — turned out NOT to be permanent: `RockingCurve`'s
`Graph1` (`Nb!B`) and `Graph2` (`NbAl!B`), and essentially all of XAS's and
UnpolPlots's oracle-required curves, had **neither** the real 8-byte 0x03
token **nor** a column-candidate-list tail match anywhere in the file —
these are ordinary, single-curve, default-dialog graphs (unlike
`NbAuRocking`'s custom-styled multi-curve layer, or "Fixed Lambdas SI"'s
"Theory SA" reference-overlay curves, both of which DO carry the 0x03
token) — meaning Origin encodes their column choice a *third* way. The
next two subsections are that search: first a negative result, then (same
day, reworked) the actual answer.

**The "third encoding" search — first pass, negative result (2026-07-04).**
Three hypotheses were chased for the default-dialog column selector; none
validated in that pass:

1. **Version-pair diff, refuted.** `specimens/converted/*.opju` (the same
   corpus projects re-saved by the trial-writer's Origin build 4.3811 from
   the corpus's native 4.3380 build) looked like a hoped-for Rosetta stone
   but wasn't one — the apparent "new token" it surfaces at `Co!C` is the
   same `__BCO` boilerplate coincidence, just version-shifted outside the
   `[340, 380)` filter window by luck, and conversion adds a further
   false-positive cluster the native corpus doesn't have.
2. **Window-local alternate encoding — found the real shape, but decoded
   it through the wrong map.** Anchoring on a length-prefixed workbook
   short-name string in `RockingCurve`'s curve-object body located a
   look-alike sequence in the *unsolved* `Graph1`/`Graph2` objects sharing
   the real token's first 5 bytes (`<flag> 01 01 01 80`) but with subtype
   `0x01` instead of `0x03` and no fixed `0x00` terminator. Decoding its
   value (`9` for `Nb!B`, `14` for `NbAl!B`) through the already-validated
   FPC-decoded-only ordinal map (`_global_column_map`) gave `Nb!C` (wrong)
   and an out-of-range result — so the lead was set aside as "a real field,
   wrong numbering rule, not worth the risk." It was actually the right
   field, decoded through the wrong map (see below).
3. **Legend / `__FRAMESRCDATAINFOS` backrefs, dead end.** Decodes as
   multi-panel frame layout geometry, not a per-curve dataset backref;
   confirmed unrelated.

**The third encoding — FOUND (same-day rework).** Re-anchoring on lead #2's
byte pattern itself, rather than the book-name string that made it look
`RockingCurve`-specific, finds it corpus-wide:

```
<flag:1> 01 01 01 80 01 <val:1>
```

Same family as the shipped token, same fixed `01 01`, subtype `0x01`
instead of `0x03`, no fixed terminator. The earlier rejection was a
**counting-convention bug, not a wrong shape**: `val` is NOT
`_global_column_map`'s FPC-decoded-only ordinal — it's a 1-based ordinal
counted cumulatively across **every allocated column of every workbook,
including empty/undecoded books and columns**, in file book-appearance
order. Decoding `RockingCurve`'s `9`/`14` through this all-columns map
(counting `NbAu`'s all 7 columns, including one FPC never decodes, before
`Nb` starts) resolves to exactly `Nb!B`/`NbAl!B` — correct. The same
re-decoding closes every other file:

* `XAS` (`Book1`=2 cols, an empty default book FPC never touches, then
  `Co`=3, `bl11YIGPy032`=3, `bl11YIGPy033`=3): `val` = 5, 8, 11 → exactly
  `Co!C`, `bl11YIGPy032!C`, `bl11YIGPy033!C`.
* `UnpolPlots` (`Book1`=2, `J315NdNiO3STO`=3, `J315NdNiO3ST1`=9,
  `PrNiO3STOprof`=3, `PrNiO3STOrefl`=9): 16 hits collapse (each doubled by
  a composite-window re-reference) to the file's 8 unique oracle pairs.
* `"Fixed Lambdas SI"` (`Book1`=2, then 10 PNR books × 11 cols): 28 hits
  collapse to exactly the file's 14 unique oracle pairs.

**Building the all-columns map without ground truth.**
`opju_codec._NAME` matches a length-prefixed dataset name for every
allocated column, including empty ones, but also binary noise. The map
builder (`opju_curves_allcols._allocated_column_map`) filters this to a
clean, `index.json`-matching inventory with three checks: (1) reuse
`scan_columns`'s length-prefix anchor; (2) keep only pure-letter,
1-2-char column suffixes and drop any `@N` sheet-suffixed match; (3) group
by book and require the column-letter set to be an exact contiguous run
starting at `A`. Book order is first-appearance order in the byte stream
— matches every stem's `index.json` book order exactly (guarded by
`test_realdata_allocated_column_map_matches_index`).

**No designation gate for this token — a deliberate, checked difference.**
The shipped 0x03 path drops any column unless its independently-validated
designation is exactly `"Y"`. Applying that same gate to the 0x01 token
was checked against every oracle-confirmed binding it resolves and would
**wrongly reject four of them**: `UnpolPlots`'s `J315NdNiO3ST1!H` /
`PrNiO3STOrefl!H` ("dR Fresnel") and `"Fixed Lambdas SI"`'s
`PNRNbAl80nm!J` / `PNRNbAu100nm!J` ("dSA") are genuinely plotted per
`plots.json` but independently designated `"Y-error"` — a legitimate
Origin usage (plotting an uncertainty column as its own curve) the
designation gate can't distinguish from the `__BCO` artifact. Since the
raw 7-byte token is already 100% precise file-wide with no cross-check at
all (confirmed by scanning every `.opju` in the corpus — the token has
**zero** hits anywhere except the four files that need it), the 0x01 path
applies only a structural safety check (an unresolvable `val` is dropped)
and skips the designation gate entirely. See `opju_curves_allcols.py`'s
module docstring for the full byte-level trail (flag-byte and tail-byte
characterization included).

**Final validation (file-wide `(book, column)` sets, both token families
merged and deduped):**

| stem | oracle pairs | decoded | correct | wrong | recall |
|------|-------------:|--------:|--------:|------:|-------:|
| `fig_pairs` (by-construction) | 2 | 2 | 2 | **0** | 100% |
| `curves_multi` (by-construction) | 3 | 3 | 3 | **0** | 100% |
| `curves_2books` (by-construction) | 2 | 2 | 2 | **0** | 100% |
| `XAS` | 3 | 3 | 3 | **0** | **100%** (was 0%) |
| `RockingCurve` | 4 | 4 | 4 | **0** | **100%** (was 50%) |
| `UnpolPlots` | 8 | 8 | 8 | **0** | **100%** (was 0%) |
| `"Fixed Lambdas SI"` | 14 | 14 | 14 | **0** | **100%** (was 14%) |
| **aggregate** | **36** | **36** | **36** | **0** | **100%** (was 30.6% / 11/36) |

Precision stays 100% (mandatory, asserted unconditionally); aggregate
recall goes from 30.6% to **100%** — reconfirmed by
`tools/origin_trial/score_curve_bindings.py` against the absolute corpus
path and `tests/test_io_origin_figures_opju.py::
test_realdata_curve_bindings_vs_plots_oracle`.

**Remaining gap — per-figure attribution (not a soundness gap).** Which
*specific* decoded figure a curve is attributed to is still a best-effort
`[anchor, next_anchor)` window heuristic (unchanged by this rework): e.g.
"Fixed Lambdas SI"'s last anchor spans to EOF and physically contains all
28 hits for both of its book families, so that one figure's `"curves"`
list absorbs bindings that structurally belong to an earlier, already-
closed figure. Every `(book, column)` pair reported is still correct —
this only affects *which* figure it's attached to, never fabricating or
mis-typing a binding.

#### 6.2.2 The global column-id table — the real curve-binding semantics (2026-07-05)

The Hc2 per-graph pass (`Hc2 data.opju`, the first corpus export whose
`index.json` `graphs[].layers[].plots` came back populated — 59 graphs /
200 plot refs, truncated by Origin's eval page limit) **falsified the
counting model above** and replaced it: on that project the merged counting
decoders produced 14 file-level bindings of which only 2 were in the oracle
union. The token value is not an ordinal to count — it is the plotted
column's **global, project-wide, creation-order serial id**, the exact
CPYUA analogue of `.opj`'s curve-anchor id (§6.1). The two "families" are
one encoding with a variable-width tagged integer:

```
<flag:1> 01 01 01 80 <width:01|03> <payload>
    width 0x01 -> <id:u8>
    width 0x03 -> <id:u16 LE> <flag:1>     (3rd byte 01/09/0b/0c/11/21 — not id)
```

The old `0x03` regex's "trailing `00`" was the u16's high byte, so counting
only ever worked on <256-column, never-edited projects (where creation
order == layout order — every pre-Hc2 corpus file). The id itself is stored
in every worksheet column's own windows-section record, two forms:

```
form A:  80 <serial> 01 10 80 03 <id:u16 LE> <pb> <fields…>
form B:  80 <serial> 07 10 01 00 00 <id:u16 LE> <pb> <fields…>   (rare)
```

`<fields…>` = tagged fields `<tag:0x80-0x9f> <len> <payload>`: the column
short name (payload = optional `0x03`-X / `0x02`-Y-error designation prefix
+ ASCII name; found as the first alnum-payload field whose next field's
payload opens `0x09`), a fixed `<tag> 01 09` separator, then the field
whose payload ends with the §4.2 designation marker (`21 51`/`21 61`/
`30 61`); a Y column's marker field is exactly `<x_partner_id:u16 LE>
21 61`, storing the column's own designated **X partner** (validated:
Hc2's `Derivative Y1` AH, id 132, pairs with `Derivative X1` AG id 131 —
not column A; decoded `x` now uses this, falling back to the book's
X-designated column, then `"A"`). Form B is exactly the four bindings the
form-A-only table missed (RockingCurve `NbAu!D`/`NbAl!B`, UnpolPlots
`PrNiO3STOprof!B`/`PrNiO3STOrefl!I`); the two forms' id sets never overlap
(0 collisions in 28 corpus files). Records are attributed to books by
containing **page span** (the `0a`-framed page headers `tree_opju`
validated byte-exact vs COM), which also gives each figure its real window
`name` ("Graph1" …: a page owning zero column records is a graph page) and
page-bounded curve windows — killing the cross-window attribution leak in
the "Remaining gap" note above. Implementation: `opju_figure_curves.py`;
the counting decoders remain only as the fallback for id-table-less
streams (synthetic fixtures, templates).

Axis-record grammar extensions found in the same pass
(`opju_axis_real_form.py`): the span separator's lead byte can be `80` as
well as `81` (strict-`81` is tried first so every pre-2026-07-05 record
parses byte-identically); a span's final (step) token can carry one
trailing subfield byte (`83 03 14 40 02` = 5.0 + trailer `02`, vs Graph4's
`83 02 14 40`; only ever admitted in a span's last slot so `from`/`to`
splits are unaffected); and the Y-start scan reaches one byte further
(plen=5 records carry an 11-byte geometry payload the old 6-byte scan
missed by exactly one). Result: 51 of Hc2's anchors decode (was 32),
covering 38 of its 40 graph pages.

**Validation.** File-level `plots.json`: unchanged 36/36, 0 wrong (table
above, now resolved via ids). Per-graph vs the populated `index.json`
oracles (`tools/origin_trial/score_curve_bindings.py`'s per-graph section +
`test_realdata_hc2_per_graph_bindings_vs_index_oracle`):

| oracle graph (Hc2) | oracle plots | decoded | verdict |
|---|---|---|---|
| Graph1 | DA!E/G/I | same | **exact** (axis ranges also exact) |
| Graph2 | DA!AH (id 132, added post-hoc) | same | **exact** |
| Graph4/6/8/10/11 | E/G/I of D3/D8/L2/L4/D5 | same | **exact** (Graph8/10 ids > 255) |
| Graph5 | D3!I | none | **missing-only**, 0 wrong (see below) |
| FitLine*/Residual*/G (51) | Book2 fit-report refs | unnamed embedded figures | unverifiable per-graph; their decoded tokens (Book2!C/D/E) are in-oracle |

0 wrong bindings anywhere. Documented negatives — do not re-chase without
new evidence:

* **Graph5** — a duplicate-window graph whose curve objects carry no id
  token at all. Its `_202`/`_232` sub-objects contain
  `90 00 80 <tag> 01 89` bytes whose `0x89` *coincidentally* equals its
  true column id 137 — the same constant appears in every graph page of
  the corpus (`_202`/`_232`-named style objects, values 0x89/0x02)
  regardless of what is plotted: style boilerplate, chased and refuted.
* The embedded fit-report graphs' fit-CURVE overlays (`FitNLCurveN!B` …)
  are not token-encoded anywhere in the byte stream.
* Graph19 / Graph34's axis records still fail both separator forms
  (flag-token + bare-literal X spans that defeat the exact-fill).

### 6.3 Origin → quantized figure mapping + gap list

Both readers emit a flat list of plot-state snapshot dicts (`name`, `layer`,
`x_from`/`x_to`/`x_log`, `y_from`/`y_to`/`y_log`, `source_hint`,
`n_curves`, `annotations`) — one dict per LAYER, not per window (item 36) —
shipped in the import payload
(`figures.extract_figures` / `figures_opju.extract_figures_opju`), surfaced
in the frontend's Library "Figures" section
(`frontend/src/components/Library/FiguresSection.tsx`). Resolving a
figure's `source_hint` to an actual imported dataset is a heuristic
(`lib/originFigures.resolveFigureDataset`); an unresolved figure shows
disabled with the hint in its tooltip rather than guessing.

**A stale `source_hint` is a genuine dangling reference, not a decode
bug (decode-plan item 40, confirmed 2026-07-09).** `PNR.opj`'s `0p023`
and `Graph46` both decode a clean, isolated, correctly-NUL-terminated
`source_hint` of `"Pd"` (no garbage around it) that never resolves to any
imported dataset. Confirmed genuinely unresolvable, not a decode error: a
full scan of every window header in the raw file (223 total, both graph
and worksheet) finds no book or sheet named `"Pd"` or containing it
anywhere, in this or any other window — the source book these two graphs
were built from was deleted from the project after the graphs were made
(Origin does not purge a graph's own stale display-name field when its
source worksheet goes away), and their curve anchors don't resolve either
(their column ids no longer exist in `column_id_map`). Correctly
surfaces as unresolved in the Library; nothing to fix.

**Proposed mapping** (design target for a richer FigureDoc entity, per
`ORIGIN_GAP_PLAN.md` #12 — partially realized by the shipped
plot-state-snapshot dicts above):

| Origin (recovered) | quantized target |
|--------------------|-------------------|
| Graph window name | figure name (`.opj` only — `.opju` has no recoverable name) |
| Layer (`_cart_object`) | one plot/panel |
| 2 layers, shared X, 2 Y ranges | dual-Y |
| Curve (`type 0x07` + DataPlot) | a plotted series |
| Layer source book short-name | resolved dataset (via `source_hint` heuristic); `.opju`'s curve tokens additionally give exact `{book, x, y}` pairs (100% precision/recall against the oracle, §6.2.1) attached wherever the per-figure attribution heuristic finds a home for them |
| X/Y range | axis limits |
| X/Y scale log | axis log flag (exact where solved, heuristic otherwise) |
| Axis title | axis label (Origin escapes stripped) |
| Legend | series labels / curve count (incl. composite `\l(layer.plot)` legends, distributed per layer — §6.1) |
| Text/line annotations | annotation list |
| `Rect*` region shapes | per-layer `region_shades` (data-coord extents + fill — §6.1) |

**Permanent gaps** (Origin features quantized cannot express / recover
yet):

- **Curve→column binding.** `.opj`'s DataPlot column selector is
  permanently undecoded — restored figures resolve to a *book*, not exact
  column pairs. `.opju`'s curve token IS decoded (§6.2.1, item 35 CLOSED,
  100% precision/100% oracle-covered recall) but per-figure *attribution*
  (which curve belongs to which decoded figure) remains a lossy heuristic
  — a correctly-resolved `(book, column)` pair can still land on the wrong
  figure within a file, or all pile onto one composite/last figure, so
  restored figures don't always split curves exactly the way Origin's own
  layer layout would.
- ~~**Curve→column binding (`.opj`)**~~ — **solved 2026-07-04** (§6.1.1,
  item 11): every curve's own global column id, independently confirmed
  against that id stamped in the column's own workbook-storage block. 100%
  precision, 45/70 (64.3%) of the combined Moke+XRD oracle — the remaining
  25 refs are two structurally distinct, out-of-reach window kinds
  (FitLinear report graphs; per-column sparklines), not undecoded curves.
  No longer a gap for `.opj`.
- **Curve→column binding (`.opju`) — per-figure attribution.** `.opju`'s
  curve token IS decoded (§6.2.1) but per-figure *attribution* (which curve
  belongs to which decoded figure) is a lossy heuristic that drops most
  curves for composite/derived real-corpus graphs — so `.opju` figures
  commonly still restore to the whole book rather than each curve's
  specific X/Y pair (plan item 35, open: no oracle exists to close the
  attribution gap). Unlike `.opj` (whose curves are scoped by the same
  window-based walk the rest of the figure decode already uses), this
  attribution problem is specific to `.opju`'s regex/anchor-based scan.
- ~~**Multi-layer window recovery (`.opj`)**~~ — **solved 2026-07-04**
  (item 36, §6.1): every layer of a graph window (not just its first) is
  now recovered as its own figure dict — axis range, curves, curve count,
  and annotations all scoped to that layer, positionally attributed and
  validated exactly against Moke's `Graph4`/`Graph7`/`Graph10` (2/2/4
  layers). What remains open is UI *representation*, not backend
  *recovery*: quantized's plot surface still has no dual-Y/stacked-panel
  view to render N linked layers as Origin composed them — the recovered
  dicts are there, one per layer, for a future frontend feature to consume.
- **Multi-layer free layout (UI target).** Origin allows N independently
  positioned/sized layers; quantized's plot surface has single-plot +
  stacked panels + one inset. Backend recovery of every layer is no longer
  the gap (see above) — >2 layers or non-stacked overlays are still lossy
  *to render*, not to decode.
- **>2 Y axes / independent top-right axes** (`XT`,`YR` with own scales).
- **Rich text** (super/subscript, Greek, per-run font/color/size) — best
  effort via an escape→Unicode transform, dropping per-run styling.
- **Non-linear scales beyond log10** (probability, reciprocal, ln, log2,
  axis breaks) — not representable.
- **Per-curve fill-under, drop lines, split symbol edge/fill, connect
  style** (spline/step/B-spline) — partially or not modelled.
- **Per-curve hidden/visibility flag (`.opj`) — investigated 2026-07-09,
  UNRESOLVED (decode-plan item 42).** `PNR.opj`'s reflectivity graphs
  (`Graph25` and its `40Oe`/`7kOe`/etc. siblings, all built from the same
  `R++`/`R--`/`T++`/`T--` book layout) each carry 6 curve anchors per
  layer (`C`=R++, `E`=R--, both `style="scatter"`, genuinely plotted;
  `D`=dR++, `F`=dR--, `Y-error`-designated, correctly hidden already by
  the dataset-level `originHiddenChannels`/`Y-error` mechanism, unrelated
  to this gap; `G`=T++, `H`=T--, plain `Y`-designated `style="line"`
  curves that Origin's own render does NOT draw at all — visible only as
  a flat legend swatch — confirmed against the live-Origin PNG oracle on
  multiple siblings, not just `Graph25`). quantized currently plots `G`/`H`
  as two extra visible series since nothing marks them hidden. Searched
  for a byte-level flag by diffing the confirmed-hidden `G`/`H` anchor
  records against the confirmed-visible `C`/`D`/`E`/`F` anchors in the
  same layer, AND against 5 confirmed-visible `style="line"` curves
  elsewhere in the same file (`Graph1`'s 4-layer SLD profile, oracle
  labelled "Nuclear SLD" and genuinely drawn) as an independent positive
  control: the group-role byte (offset 6), the style byte (offset 76,
  already the decoded line/scatter field), symbol-kind (offset 23), and
  two exploratory bytes (offsets 15/17) were all checked — none separates
  hidden from visible (offset 17 read `0x01` on BOTH the hidden `G`/`H`
  pair AND every visible `Graph1` line curve, ruling it out). No
  byte-proven mechanism found; left undecoded rather than guessed. A
  future pass needs more independent hidden-vs-visible ground truth
  (ideally a COM oracle querying `layer.plotN` visibility across many
  curves) to isolate the real flag.
- **Axis-title unit vs. worksheet-column unit mismatch (`.opj`) —
  investigated 2026-07-09, UNRESOLVED (decode-plan item 42).** The same
  `PNR.opj` reflectivity graphs' decoded X range (e.g. `Graph25`:
  `(0.0005, 0.15)`) is exactly the book's own raw `Q` column values
  (`origin_column_names`' X column, metadata `x_unit = "A-1"`, i.e.
  Å⁻¹) — but the figure's own manually-typed `x_title` reads
  `"Q (nm⁻¹)"`, and the live-Origin PNG oracle's real rendered axis
  spans roughly 10× wider (~0-1.6, confirmed by a direct zoomed-pixel
  read of the tick labels, ruling out an initial misreading of the same
  image) — exactly the Å⁻¹→nm⁻¹ conversion factor (1 Å⁻¹ = 10 nm⁻¹).
  The decoded axis-range OFFSETS themselves (15/23 X, 58/66 Y) are not in
  question — they are oracle-verified exact on Moke/XRD/hc2convert, and
  a project-wide grep confirms the `x_unit`/`x_title` mismatch is
  consistent (real Å⁻¹ data, an nm⁻¹-labelled axis) across this whole
  PNR project. Origin evidently renders using a real unit conversion
  quantized does not apply; no scale-factor byte field was found in the
  layer-continuation record to decode this generally (the two candidate
  numbers, from-worksheet-unit-string and from-axis-title-string, are
  both plain text, not a binary field), and a blind "always ×10 when the
  unit strings look like a length mismatch" heuristic was rejected as
  unproven/overfit for a single project rather than shipped. Left
  undecoded; the plan item narrows to this evidenced-but-unfixed root
  cause rather than "wrong layer"/"wrong offset", both of which are ruled
  out.
- **Arrow/line annotations with arrowheads** — quantized `refLines` are
  axis-parallel only; `Line*` objects (type `0x22`) ship their text (if
  any) but not their geometry. ~~Box/region annotations~~ — **decoded
  2026-07-11** (item 41, `Rect*` type-`0x31` region shapes → per-layer
  `region_shades`, see §6.1); fill *transparency* remains undecoded
  (render-side presentation choice, documented in §6.1).
- **X-scale type bit (`.opj` only)** — still heuristic-only there: no
  `.opj` log-x graph exists in the corpus and Origin ≥2023 can't write
  `.opj` to make one, so the `.opju` X flag's twin (if any) can't be
  isolated from constants. `.opju` X-scale is EXACT since 2026-07-06
  (`_real_x_log_flag`, both record forms); see §6.1/§6.2.
- ~~**Y-scale type bit**~~ — **solved 2026-07-04** for both containers (no
  longer a gap): `.opj` payload offset 98/99 (§6.1) and `.opju`'s real-form
  Y flag before the `00 10 10 00` marker (§6.2) are both exact, `01 00`
  linear / `08 01` log10, validated against >300 layers corpus-wide.

### 6.4 Graph templates (`.otp`/`.otpu`) → quantized `GraphTemplate` (decode-plan #21, gap-ecosystem item 5)

**Container: confirmed, not a new family.** `io/origin_project/templates.py`.
Both template extensions are the SAME CPY container family §2 already
documents — `.otp` opens with `CPYA` (the corpus's `SLD_DoubleY.otp` is
`CPYA 4.3227`, an older sub-version of the family the `.opj` reader already
handles), `.otpu` with `CPYUA` (all four corpus `.otpu` files are
`CPYUA 4.3380`, byte-identical preamble to a real `.opju` up through the
`PrvwOPJU` preview preamble of §2.2). No new container RE was needed.

**What decodes with ZERO new byte-level RE — the existing figure decoders,
pointed at a template's raw bytes.** `figures.extract_figures`/
`figures_opju.extract_figures_opju` take raw file bytes, not a parsed
workbook — a template's graph window(s) are laid out exactly like a
project's own, so axis ranges, log flags, titles, legend text/labels, frame
and page geometry all decode verbatim against 4 of the 5 corpus templates
(`SLD_DoubleY.otp`, `PNR-SF.otpu`, `SLDdouble.otpu`, `UnpolFresnelNR.otpu`).

**What does NOT decode via the existing curve-binding path: curve style —
solved differently.** A template carries no workbook columns, so
`opj_curves.extract_curves`/`opju_figure_curves.extract_curves_by_id` (which
bind a curve to `(book, x, y)` via a global column-id lookup built by
scanning the project's OWN column-storage blocks — §6.1.1/§6.2.1) always
find an empty id map for a template file, silently dropping every curve
even though its raw style record is present and fully decodable on disk.
Confirmed by direct byte-level recon: every corpus template carries real
`curve_style_color.style_fields`-decodable records (explicit RGB colors,
line/scatter, line width, symbol size) with **no book/column resolution
required at all** — the style lives entirely inside the curve's own anchor
record (`.otp`) / sparse id token (`.otpu`), the identical record
`curve_style_color.py` already decodes for real projects. `templates.py`
reuses ONLY the style half of those two decoders — `_template_curve_styles_opj`
scans for the same `01 00 00 00 <id>` anchor + DataPlot-magic pairing
§6.1.1 documents but skips the `id_map`/`x_columns` binding step entirely;
`_template_curve_styles_opju` finds every `opju_figure_curves._CURVE_TOKEN`
match and reconstructs its style record via the existing
`curve_style_color.opju_style_record`, independent of
`opju_figure_curves.column_id_table` (empty for a template by construction —
no workbook column ever assigns the token's id). Book/x/y stay permanently
absent for a template's curves by design, not by gap — there is no dataset
for them to name.

**One corpus file's axis record is a genuinely new, undecoded shape —
`PNR.otpu`.** Its single axis anchor (`03 00 00 1f`) parses as `None` under
all three known `.opju` axis-record forms (specimen §6.2's default-dialog
form, real §6.2's "Real corpus" form, and the hybrid fallback) — a 4th
record shape this pass does not characterize. Per the "conservative first
decoder" scope for this item, it is left undecoded and documented here
rather than chased with a new RE pass. Its curve-style tokens (6 of them)
decode independently and fine (the tell that style really doesn't depend on
the axis record at all) — `read_origin_template` degrades this ONE file to
a styles-only partial (`overrides: null`, `seriesStyles` populated) rather
than failing the whole import or guessing an axis record.

**Mapping to `GraphTemplate` (`frontend/src/lib/figuredoc.ts`) — honestly
partial.** `name` is the file stem; `style` stays the fixed string
`"default"` (Origin templates carry no quantized preset concept to
recover). `overrides` (`FigureOverrides`) comes from the template's FIRST
decoded graph layer only:

| Decoded (figure-layer dict) | `FigureOverrides` key | Notes |
|---|---|---|
| `x_from`/`x_to` | `x_lim` | only when both finite and distinct |
| `y_from`/`y_to` | `y_lim` | only when both finite and distinct |
| `legend_labels`/`legend_pos` | `legend.show`/`legend.loc` | `loc` = nearest-quadrant string (`"upper right"` etc.), mirroring `frontend/src/lib/originFigures.ts`'s `originLegendPos` |

A template with >1 layer (a double-Y style like `SLD_DoubleY.otp`/
`SLDdouble.otpu`) has no way to carry its 2nd layer's own Y range in this
shape — `GraphTemplate` itself has no multi-layer/y2 concept — so that
layer's style is simply not represented; this is a target-**shape**
limitation, not a decode failure. Every other `FigureOverrides` key (`grid`,
`ticks`, `spines`, `margins`, `font_size`/`font_name`, `annotations`) has no
isolated on-disk field this codebase decodes (§6.3's permanent-gaps list
already covers grid/ticks/font) and stays absent.

`seriesStyles` (`ExportSeriesStyle[]`) is built from EVERY decoded curve
style record found in the file, in on-disk order — since `GraphTemplate.
seriesStyles` is already one flat list with no per-layer grouping, collapsing
a multi-layer template's curves into one file-wide list matches the target
shape's own limitation rather than adding a new one:

| Decoded (`curve_style_color.style_fields`) | `ExportSeriesStyle` key | Notes |
|---|---|---|
| `style == "scatter"` | `marker: true, width: 0` | hides the connecting line, mirrors `originCurveSeriesStyle` |
| `style == "line"` | `width: 1.5` | overridden by a decoded `lineWidth` below |
| `color` (`#RRGGBB`) | `color` | direct |
| `symbol` (any shape) | `marker: true` | **no shape field exists in `ExportSeriesStyle`** — a decoded marker glyph (square/circle/triangle/…) only turns the marker on; the glyph itself is a genuine, permanent target-shape gap |
| `lineWidth` (pt) | `width` | only when `style != "scatter"` |
| `symbolSize` (pt) | `marker_size` | only once a marker is already on |

**Corpus summary (5 template files, all local-only, never committed):**

| File | Container | Layer(s) decoded | Curve styles decoded | Notes |
|---|---|---|---|---|
| `SLD_DoubleY.otp` | CPYA 4.3227 | 2 (double-Y) | 5 | full template |
| `PNR.otpu` | CPYUA 4.3380 | 0 | 6 | axis record: new, undecoded shape — styles-only partial |
| `PNR-SF.otpu` | CPYUA 4.3380 | 1 | 12 | full template |
| `SLDdouble.otpu` | CPYUA 4.3380 | 1 | 5 | full template |
| `UnpolFresnelNR.otpu` | CPYUA 4.3380 | 1 | 3 | full template, legend position resolved |

**Import surface.** `GET /api/import/template?path=...` (server-visible
path, same containment guard as `routes/parsers.py`'s `/import`) and
`POST /api/import/template/upload` (`routes/import_template.py`) — a
SEPARATE surface from `routes/parsers.py`'s dataset importers, since a
template carries no `DataStruct` at all; `.otp`/`.otpu` are deliberately
**never** registered in `io/registry.py` (the single-registry rule governs
data parsers, not style presets). The frontend wrapper (an `api.ts` client
method + an "Import Origin template…" UI hook-in landing the result in the
saved graph-templates store) is explicitly out of scope for this item and
stays booked in `plans/GAP_ECOSYSTEM_PLAN.md`.

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
*reads* it, so a native CPYA writer reaches every Origin version — the
highest-value export lever.

**Status: LOADS IN REAL ORIGIN (2026-07-07, plan item 34 closed).** The
loader's full requirement set was pinned by the PN/PJ/PK/PT/PU/PW COM
probe series (`docs/origin_re/validation_log.md`, 2026-07-07 entry) and
the writer emits exactly that shape (`writer_blocks.py` holds the
sanitized byte templates + the measured field model):

* **stream** — header line + 123-byte fh block; per column
  `[NULL][147B column header][data block]` (name @88, filled/allocated
  row u32s @25/@6); `NULL NULL`; per book a window section: window header
  (short name @2, long name at the 195-byte prefix's end anchored by
  `@${`), the 365-byte `Pd` sheet sub-header (row count u16 @82), the
  `__LayerInfoStorage` record group (a window section must carry at least
  ONE `133B/72B/content` record group or the load is refused), then per
  column a 519-byte property block + a `LongName\r\nUnit\r\nComment`
  label block. **Worksheet window sections are separated by SIX null
  blocks** (two folds the next book into the previous one); three nulls
  close the stream.
* **column ↔ dataset binding** — the 519B property block's u16 serial @4
  is matched against the dataset's **1-based ordinal in the file's stream
  order**; @30 is the constant 9; @35 carries the associated X column's
  serial (0 on X/disregard columns); @38 is 0x51 X / 0x61 Y / 0x41
  disregard; @51 is the 1-based X-group index. Wrong values here do NOT
  refuse the load — the columns silently render EMPTY (the PU5 probe's
  failure mode), so this block is the writer's most safety-critical spot.
* **tail** — params section, NULL + project record, a note list that
  CONTAINS a `ResultsLog` note (presence required, content free), NULL,
  the `37 + len(tree)` scalar, the constant 16-byte id blob, the folder
  tree, and a global-storage section of exactly 8 indexed records
  (content lax — three constant records + five empties suffice; even
  dialog-state XML referencing nonexistent windows is accepted); plus the
  file-size u32 at fh offset 115. Everything else measured lax (fh's
  seven `rand()`-like u32s, tree window ordinals, storage content).

Verified live on Origin 2026b: single-book, multi-book, and synthetic
(NaN-cell) writer outputs all `app.Load` = True with the right book
count, and expASC re-exports are **value-exact with correct names and
units** (`tools/origin_trial/probe_opj_loader.py verify`). Re-verify per
license window via the validation-log checklist.

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

- **Item 34 — `.opj` writer real-Origin load, CLOSED 2026-07-07.** The
  writer's output loads in real Origin (2026b) and re-exports value-exact;
  the loader requirement set is documented in §8 and
  `docs/origin_re/validation_log.md`.
- **Item 35 — figure curve→dataset column binding, CLOSED 2026-07-04.**
  BOTH containers decode. `.opj` (§6.1.1, `opj_curves.py`): the per-curve
  anchor record's global column serial id — 100% precision, 45/70 (64.3%)
  of the combined Moke+XRD oracle, the shortfall being two structurally
  out-of-reach window kinds (FitLinear report graphs; per-column
  sparklines), not undecoded curves. `.opju` (§6.2.1, `opju_curves.py` +
  `opju_curves_allcols.py`): two merged token subtypes — 0x03
  (custom-styled/multi-curve graphs, gated on independently-validated
  `"Y"` designation) and 0x01 (ordinary single-curve default-dialog
  graphs, an all-columns cumulative ordinal, deliberately NOT
  designation-gated; the one-time "third encoding" fell to this
  counting-convention fix). Reworked against the real per-plot
  `plots.json` oracle (`tools/origin_trial/export_plot_refs.py`), which
  also exposed and killed the `__BCO` boilerplate false positive.
  **Precision 100%, aggregate oracle-covered recall 100% (36/36)** — up
  from 30.6% — pinned by `test_realdata_curve_bindings_vs_plots_oracle`'s
  per-stem floors (all 1.0). Per-figure *attribution* (which curve
  belongs to which decoded figure) remains a best-effort heuristic — a
  narrower, documented remaining gap, not a soundness one.
- **Item 36 — Y-axis lin/log scale-flag byte (both containers), CLOSED
  2026-07-04.** Both `.opj` (§6.1, `figures.py`'s `_y_scale_flag`, payload
  offset 98/99) and `.opju`'s real-corpus form (§6.2,
  `opju_axis_real_form.py`'s `_real_y_log_flag`) now decode Y-scale exactly
  (`01 00` linear / `08 01` log10), validated against 14 real-corpus
  `.opju` anchors and >300 `.opj` layers corpus-wide. **X-scale followed on
  2026-07-06 for `.opju` only** (`_real_x_log_flag`, the geometry-tail
  `01`/`08 01` field, exact in both record forms — §6.2); `.opj` X stays on
  the decade heuristic (no log-x oracle exists or can be generated) — a
  documented, narrower remaining gap.
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
- **Sheet-name exact bytes** (§4.1's `50 64` prefix) and **extra-sheet
  suffix numbering** (§5) — medium confidence, not exhaustively pinned.
- **Templates (`.otp`/`.otpu`)** — same CPY family, not yet RE'd as a
  quantized style-preset source (plan item 21).
- **Analysis-log structured parsing — CLOSED 2026-07-04** (plan item 22):
  the results log (§7) parses into structured per-fit records; the
  US-locale timestamp assumption is the documented residue.
