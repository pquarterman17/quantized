# Origin project format (`.opj` / `.opju`) — clean-room notes

Reverse-engineering notes for the from-scratch Origin reader
(`src/quantized/io/origin_project.py`). Derived by inspecting sample files
locally (`tests/realdata/origin/`, gitignored). We do **not** use the GPL
`liborigin` — this repo is Apache-2.0 (see `architecture-guards.md` #3). Format
*facts* (byte layouts) aren't copyrightable; the implementation is our own.

**Status (2026-07-04, overnight run):** `.opj` support is BROAD — worksheet
data for every book AND extra sheet (`Book@N`), real column names/units/
designations, book display titles, figures as plot-state snapshots
(`figures.py`), import-all-books flow, plus EXPORT: a native `.opj` writer
(`writer.py`, readable by every Origin version) and multi-book `.ogs`
scripts. **`.opju` worksheet data now decodes too** — the codec is solved
(canonical Burtscher FPC, `docs/origin_re/opju_container.md` + `opju_codec.py`)
and validated bit-exact against Origin's own ground-truth export (XAS 243/243
values; hundreds of columns across the corpus). `.opju` labels fall back to
Origin designations (the Unicode windows-section name decode is future work),
and long near-constant-stride axis columns are dropped by a strict desync gate
(an exact DFCM hash-collision detail remains) rather than risk silent garbage.
Hardened by a fuzz/sweep/perf suite and the ground-truth oracle suite.

Note: empty numeric cells store Origin's missing-value sentinel
`-1.23456789e-300` (bit pattern `0e 2c 13 1c fe 74 aa 81`), *not* flagged by the
mask — the decoder maps it to `NaN`.

## Container family

Every Origin project/template file begins with an ASCII magic + version line:

| Ext | Magic | Meaning |
|-----|-------|---------|
| `.opj` | `CPYA 4.3380 188 W64` | project, **ANSI** strings |
| `.opju` | `CPYUA 4.3380 188` | project, **Unicode** strings |
| `.otp` / `.otpu` | `CPYA` / `CPYUA` … | graph/analysis **templates** (same family) |

Key insight: **`.opju` is `CPYUA` — the Unicode sibling of the same `CPYA`
structure, not an unrelated format.** Same version tokens (`4.3380`, older files
`4.3227`), same section layout. Decoding `.opj` gets us ~all of `.opju`; the
delta is string encoding (ANSI vs UTF-16/UTF-8) and a `PrvwOPJU` preview blob.
Header line: `CPY[U]A <fileVersion> <buildNumber> <arch>` (e.g. `W64`).

## Worksheet columns (validated)

Column data is stored as named datasets keyed `"<Book>_<Col>"` (e.g. `Book1_A`,
`Book1_B`, …). Each dataset:

1. the name as a NUL-terminated string (`Book1_A\0`), then a column-header block
   (per-column metadata: value type, count, mask, display),
2. a data payload framed as `0x0A <uint32 size LE> 0x0A <payload>`,
3. payload = `size / 10` records, **10 bytes each**: an 8-byte little-endian
   `float64` value **+ a 2-byte per-cell flag** (Origin's cell mask/state).

Validated on `Moke.opj` `Book1_A`: `size = 1810 → 181 records`; decodes to a
clean symmetric field ramp **−6796 … +6746 Oe** (the MOKE loop's field axis).
`stride = 8` yields garbage (the 2-byte flags misalign), `stride = 10` is exact.

> Column value type isn't always `double`; the column header carries the type +
> value size. M1 reads that header rather than assuming 10-byte records — the
> `Moke` case is the default (double + mask). Text/other types come later.

### Non-double column values (plan item 4 — decode half, 2026-07-04)

The 147-byte column-storage header does **not** carry a byte offset that
reliably distinguishes a double column from a non-double one — a full
per-offset diff of 1242 known-double vs 58 known-text column headers in
`hc2convert.opj` found no offset where the two groups' values cleanly split
(one offset, 0x3d, is a useful *secondary* signal — see below — but it does
not distinguish double from text). Decoding instead content-sniffs the data
block, same spirit as the existing `plausible_column`/`_looks_textual` gates:

- **Origin stores every worksheet cell in the same 10-byte
  `<u16 mask><8-byte value>` record regardless of the column's declared
  value type.** There is no narrower on-disk width for `int`/`float32` in
  this container — a genuinely int- or float32-typed column's cells are
  still plain IEEE754 float64 bit patterns (e.g. `12.0`), so they already
  decode correctly through the existing `decode_doubles` +
  `plausible_column` path with **no code change needed**. A corpus-wide scan
  (`hc2convert`, `Moke`, `XRD`, `XMCD`, `MnN_Diffusion_PNR`,
  `SuperlatticeFits` — 2687 total column pairs) found zero data blocks at
  any stride other than 10 bytes/record.
- **"Text & Numeric" columns reuse the same 10-byte record**: the 8-byte
  value area holds a NUL-terminated ASCII/latin-1 string (up to 7 chars)
  followed by a `0x00`/`0x01` tag byte and zero padding, instead of a raw
  float64. Origin's own literal fit-failure sentinel is `"NaN"` (bytes
  `4e 61 4e 00 01 00 00 00` — string, NUL at value-offset 3, tag `0x01`,
  three zero-pad bytes): pinned from `hc2convert.opj`'s 58 Hc2-extraction
  columns where the critical-field fit produced no value for any row —
  112,887 matching records, zero counter-examples across the 6-file scan.
  `container.decode_inline_text` decodes this shape; `opj.py` wires it into
  `metadata["origin_text_columns"]` (never `.values` — the data contract
  stays numeric).
- **A record with no NUL within its 8-byte value area is an unsafe
  overflow**, not a decode target: Origin's FitLinear/NLFit auto-generated
  "Notes"/"Summary"/ANOVA report-sheet columns (e.g. `hc2convert`'s
  `Book2_C@2`../`Book2_X@2`, `Moke`'s `Book4_C@2`..`Book4_Y@2`) embed
  variable-length reference strings like `"cell://Parameters.Slope.Value"`
  that span *multiple* physical 10-byte records with no row-aligned
  boundary, followed by real double values for the sheet's remaining rows.
  Reconstructing the true row alignment needs more RE than plan item 4
  scoped (a materially different, variable-length problem) — these stay an
  honest drop, exactly like an unrecognized type. `decode_inline_text`
  returns `None` for the whole column the moment one record lacks an
  in-range NUL, so this family can never partially/incorrectly decode.
- **Secondary corroborating signal (header offset 0x3d):** across every
  double AND text(`NaN`)-sentinel column in `hc2convert.opj`, header byte
  0x3d is `0x0a` (100%); every FitLinear/NLFit report-sheet column shows a
  different, varied value there. This byte reliably flags "plain worksheet
  data column" vs "auto-generated report construct" but does **not**
  distinguish double from text, so the implementation doesn't depend on it
  — noted here in case it helps a future RE pass on the report-sheet family.

**Corpus census (real `.opj` files, all books):** `hc2convert.opj` 1242
double / 58 text(`NaN`) / 407 still-dropped (report-sheet family); `Moke.opj`
71/0/25; `XRD.opj` 17/0/3; `XMCD.opj` 554/0/1; `MnN_Diffusion_PNR.opj`
179/0/18; `SuperlatticeFits.opj` 107/0/5. Only `hc2convert` has the
inline-text sentinel pattern in this corpus; the other files' non-double
columns are entirely the report-sheet family.

## Figures (present, later milestone)

The graph windows are in the file: token counts in `Moke.opj` — `Graph:105`,
`Layer:37`, `Curve:66`, `Legend:15`; `XRD.opj` — `Graph:8`, `Layer:13`;
`XAS.opju` — `Graph:6`, `Legend:3`. A graph = layers → curves that *reference*
datasets by name + carry axis ranges / styling. So the figure definition is
recoverable; the work is mapping Origin's graph model → quantized's plot spec.
Exact-pixel reproduction is a stretch; the underlying data is never lost.

## Milestones

- **M1 — `.opj` worksheet data → `DataStruct`.** Parse header → walk the object
  framing → extract spreadsheets + columns → decode column data → one
  `DataStruct` per sheet (book/sheet/column names + units in metadata). The
  high-value "recover my data" deliverable.
- **M2 — `.opju` worksheet data.** *Harder than first estimated* — see findings
  below.
- **M3 — figures → quantized plots.** Graph/Layer/Curve → plot spec (axes,
  series, basic styling). Partial fidelity expected.

## M2 (`.opju`) findings — why it's a separate effort

The `.opju` container is *not* just "`.opj` with Unicode strings". Confirmed by
probing `XAS.opju` / `RockingCurve.opju` / `UnpolPlots.opju`:

- **Header + preview.** Header line `CPYUA <ver> <build>\n` (no ` W64 #` tag),
  then a `PrvwOPJU` preview preamble. The shared `CPY` file-header block
  (`size=123`, starts `02 00 …`) resumes after it (offset ~69 in `XAS.opju`).
- **Different datasets framing.** After the file-header block + a `size==0`
  spacer, the next bytes (`80 2b 03 00 …`) are **not** the `.opj`
  `<u32><0x0A>` frame — the `.opju` datasets section is framed differently
  (looks type-tagged / var-length).
- **Compression.** The file carries zlib streams (`78 9c`/`78 da`); the ones
  found so far inflate to ~92 KB bitmap-like blobs (graph/preview images), not
  worksheet columns. The **column data is not present as plain `float64` runs
  anywhere** (raw or inside those zlib streams) — so it is stored in a different
  numeric encoding and/or **raw-deflate** streams (no `78` header) that a naive
  scan misses.

**UPDATE (2026-07-04): SOLVED** — see `docs/origin_re/opju_container.md`. The
data is NOT deflate-compressed and NOT the XOR-delta/PREV-PRED scheme the early
recon guessed; it is **canonical Burtscher FPC** (two racing predictors — FCM
value-hash + DFCM stride-hash, 2^12 tables — with a per-value XOR residual),
stored plainly in the container, which is why no raw float64 runs were found.
Cracked via known-content Rosetta specimens generated with an Origin 2026b
trial (`tools/origin_trial/`), then locked against `specimens/ground_truth/`.
`read_opju` (`opju_codec.py`) now decodes worksheet columns bit-exact; the
outer record framing is parsed as LEB128-varint records located by a
cursor-walked scan. `.opju` labels currently fall back to Origin designations.

## Column long-names / units (later milestone)

M1 labels value columns by their Origin **designation** (A, B, C…) because that's
all the per-column header block carries — the 147-byte header holds the *internal*
dataset name (`Book1_A`) + binary column formatting, but **not** the user-facing
long-name or units. Those live only in the spreadsheet **window definition** in
the windows section (the part after the datasets section, which the M1 walker
stops before). Evidence: analysis-log references there spell out
`[Book5]Sheet1!(E"H",N"Kerr Signal")` — designation `E`, X long-name `H`, Y
long-name `Kerr Signal`. Recovering names/units is therefore its own
windows-section decode pass (comparable in effort to M2), **not** an extension of
the header-block read — so M1 keeps honest A/B/C labels rather than risk
mislabeling columns by scraping strings.

## Testing

Real projects may hold private data, so fixtures live in
`tests/realdata/origin/` (gitignored) behind the `realdata` marker (auto-skips in
CI / on machines without the corpus). Where possible, pin decoded values
(e.g. `Moke.opj Book1_A` first point ≈ −6796.22) as regression anchors.

## Reference

`liborigin` (GPL, SourceForge) and the R package `Ropj` are the prior
reverse-engineering efforts and a **format reference only** — never a dependency,
never copied. `.opju` has no prior open reader; those notes are ours.
