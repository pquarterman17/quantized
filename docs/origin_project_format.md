# Origin project format (`.opj` / `.opju`) — clean-room notes

Reverse-engineering notes for the from-scratch Origin reader
(`src/quantized/io/origin_project.py`). Derived by inspecting sample files
locally (`tests/realdata/origin/`, gitignored). We do **not** use the GPL
`liborigin` — this repo is Apache-2.0 (see `architecture-guards.md` #3). Format
*facts* (byte layouts) aren't copyrightable; the implementation is our own.

**Status:** **M1 landed** — `.opj` worksheet data decodes to `DataStruct`
(`io/origin_project.py`), validated on the real corpus (XRD θ–2θ, MOKE loop, XMCD
energy scans). M2 (`.opju`) and M3 (figures) next. Update this file as milestones
land.

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

**Next-pass plan:** (1) parse the `.opju` datasets-section framing to find the
per-column records; (2) handle raw-deflate payloads (`zlib.decompressobj(-15)`);
(3) confirm the record layout (double vs float32, mask/no-mask) against a decoded
column with a known shape. Until then `_read_opju` guides to the Origin Viewer
export path.

## Testing

Real projects may hold private data, so fixtures live in
`tests/realdata/origin/` (gitignored) behind the `realdata` marker (auto-skips in
CI / on machines without the corpus). Where possible, pin decoded values
(e.g. `Moke.opj Book1_A` first point ≈ −6796.22) as regression anchors.

## Reference

`liborigin` (GPL, SourceForge) and the R package `Ropj` are the prior
reverse-engineering efforts and a **format reference only** — never a dependency,
never copied. `.opju` has no prior open reader; those notes are ours.
