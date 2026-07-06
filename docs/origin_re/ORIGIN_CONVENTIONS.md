# Origin conventions — the consolidated reference

A single "library of Origin conventions" for everything `quantized` has
reverse-engineered about OriginPro project files (`.opj` / `.opju`). This
document does not replace the detailed sources — it indexes and synthesizes
them so a practitioner can find an answer in seconds instead of re-deriving
it. **The detailed byte-level trails live in the sources cited inline; when
this document and a cited source disagree, the source (and ultimately the
code) is truth.**

Grounding discipline: every convention below cites its source as
`module.py::function`, a `docs/origin_re/<file>.md` / `docs/origin_project_format.md`
section, a `tests/test_io_origin_*.py` test, or a `tools/origin_trial/*.py`
script. Anything not yet confirmed against Origin's own output is marked
**(unverified)** or **(heuristic)**. Nothing below is invented — where the
repo has not reverse-engineered something, it says so.

## Table of contents

1. [Overview](#1-overview)
2. [Codebase map](#2-codebase-map)
3. [Column data](#3-column-data)
4. [Column metadata](#4-column-metadata)
5. [Books / sheets / folder tree](#5-books--sheets--folder-tree)
6. [Figures](#6-figures)
   - 6.1 [Curve bindings](#61-curve-bindings)
   - 6.2 [Axis ranges + scale flags](#62-axis-ranges--scale-flags)
   - 6.3 [Axis-title / legend / annotation routing](#63-axis-title--legend--annotation-routing)
   - 6.4 [Annotation positions](#64-annotation-positions-confirmed-model)
   - 6.5 [`.opj` vs `.opju` framing differences, at a glance](#65-opj-vs-opju-framing-differences-at-a-glance)
7. [Rich text](#7-rich-text)
8. [COM oracle methodology](#8-com-oracle-methodology)
9. [Verification & discipline](#9-verification--discipline)
10. [Known negatives / NOT decoded](#10-known-negatives--not-decoded)
11. [RE pitfalls & lessons](#11-re-pitfalls--lessons)
12. [Index](#12-index)

---

## 1. Overview

Origin project files come in two container families sharing one conceptual
layering (worksheet data / windows metadata / figures), but with unrelated
concrete byte framings:

| Ext | Magic | Strings | Era |
|-----|-------|---------|-----|
| `.opj` | `CPYA 4.3380 188 W64 #` (also `4.3227`) | ANSI/latin-1 | pre-2023 Origin; Origin ≥2023 can still *read* it but not write it |
| `.opju` | `CPYUA 4.3380 188` (also `4.3227`, `4.3811`) | Unicode/UTF-8 | 2018+; `.opju` is CPYUA, the Unicode sibling of the same `CPYA` family, not an unrelated format |

Source: `docs/origin_project_format.md` §2 (container family + magic table).

**Detection/routing.** `read_origin_project`/`read_origin_books`
(`src/quantized/io/origin_project/__init__.py`) dispatch purely on file
extension (`.opju` case-insensitive suffix → the CPYUA reader path, else
CPYA) — no content sniffing is needed because the extension is reliable.

**Layering (pure-library discipline).** Every module under
`src/quantized/io/origin_project/` is a pure library: bytes/`Path` in,
`DataStruct`/plain dicts out — no `fastapi`/`pydantic`/`quantized.routes`
imports anywhere in the package (enforced repo-wide by
`.claude/rules/architecture-guards.md` #1 and `tests/test_repo_integrity.py`).
Decoders never gate on presentation concerns; that happens at the import
route/frontend boundary instead — e.g. `drop_empty_library_books`
(`__init__.py`) is explicitly a *presentation* gate applied after a complete
read, so `read_origin_books` itself stays a complete, ungated reader (its own
docstring is explicit about this distinction, mirroring
`drop_nonactionable_figures`'s pattern elsewhere in the codebase).

**Golden rule for this whole subsystem: "samples are not standards."**
Decoders are written as general grammars validated against the corpus, not
grammars overfit to it — undecodable shapes are documented as open gaps
rather than guessed at (see §9, §10). This is a standing project directive,
not a per-module choice.

---

## 2. Codebase map

All paths relative to `src/quantized/io/origin_project/`.

| Module | Decodes | Key entry point(s) |
|---|---|---|
| `container.py` | CPY block-stream primitives shared by `.opj` readers: `<u32 size><0x0A><payload><0x0A>` block walking, the `ORIGIN_MISSING` sentinel, the 10-byte double/inline-text/report-string record shapes | `walk_blocks`, `decode_doubles`, `decode_inline_text`, `decode_report_strings` |
| `opj.py` | `.opj` (CPYA) worksheet reader: assembles datasets + windows metadata into `DataStruct`(s) | `read_opj`, `read_opj_books` |
| `opj_curves.py` | `.opj` curve→column binding (item 11): the per-curve global column-id anchor immediately before each DataPlot | `extract_curves`, `column_id_map`, `book_x_columns` |
| `opju.py` | `.opju` (CPYUA) worksheet reader: wires `opju_codec` + `windows_opju` into `DataStruct`(s) | `read_opju`, `read_opju_books` |
| `opju_codec.py` | The canonical Burtscher FPC worksheet-column codec: record framing, ZigZag segment grammar, FCM/DFCM predictors | `scan_columns`, `decode_stream`, `curve_plot_style`, `tail_start` |
| `opju_curves.py` | `.opju` curve→column binding, subtype `0x03` token (custom-styled / multi-curve / Select-Data graphs), designation-gated | `extract_curves`, `book_columns_from_bytes`, `allocated_columns_from_bytes` |
| `opju_curves_allcols.py` | `.opju` curve→column binding, subtype `0x01` token (ordinary single-curve default-dialog graphs), all-columns cumulative ordinal, deliberately not designation-gated | `extract_curves_allcols` |
| `opju_figure_curves.py` | **The 2026-07-05 rework**: the global column-id table — unifies the `0x03`/`0x01` token families as one tagged-width id field, scoped by `0a`-framed page spans | `column_id_table`, `extract_curves_by_id`, `opju_pages` |
| `opju_figure_text.py` | `.opju` axis-title / legend / annotation text routing via a tagged name-header + framed-text grammar | `routed_figure_text` |
| `opju_reports.py` | `.opju` report-sheet column residue (`cell://...` reference strings): `0x01` tag byte + ZigZag segment grammar | `scan_report_columns` |
| `opju_axis_real_form.py` | `.opju` real-corpus-form axis record decode (value tokens, the Y-scale flag) — split out of `figures_opju.py` for the 500-line ceiling; no public `__all__`, imported by name | (internal to `figures_opju.py`) |
| `figures.py` | `.opj` figure extraction: Graph→Layer→Curve, the 133-byte object header, axis ranges/scale flags, axis-title/legend/annotation routing, multi-layer emission | `extract_figures` |
| `figures_opju.py` | `.opju` figure extraction: `03 00 00 1f` layer anchor, specimen form + real-corpus form, wires `opju_axis_real_form` + `opju_figure_curves` + `opju_figure_text` | `extract_figures_opju` |
| `windows.py` | `.opj` windows-section metadata: column long-names/units/comments/designation | `window_metadata` |
| `windows_opju.py` | `.opju` windows-section metadata: 2-byte designation marker + label record | `opju_window_metadata` |
| `tree.py` | `.opj` Project Explorer folder tree (which folder a window lives in) | `opj_folder_paths` |
| `tree_opju.py` | `.opju` Project Explorer folder tree; also exposes the `0a`-framed page-header regex `_OPJU_WIN_RE` that `opju_figure_curves.py` reuses for page-span scoping | `opju_folder_paths` |
| `notes.py` | Results-log + notes-window recovery; one byte-level scanner serves both containers | `results_log`, `parse_results_log`, `notes_windows` |
| `writer.py` | Native `.opj` (CPYA) writer | `opj_bytes`, `write_opj` |
| `origin_richtext.py` | LabTalk rich-text escape (`\g()`, `\+()`, `\-()`, `\(NNN)`, `\(xHHHH)`, …) → plain display text | `clean_richtext` |
| `__init__.py` | Package entry point: extension dispatch, provenance attachment (results log + notes), folder-path attachment, the Library presentation gate | `read_origin_project`, `read_origin_books`, `drop_empty_library_books` |

Source: each module's own header docstring (read directly for this
document) plus `docs/origin_project_format.md`'s narrative for the modules
it covers (container/opj/opju/opju_codec/figures/figures_opju/windows/
windows_opju/notes/writer/opj_curves/opju_curves/opju_curves_allcols/
opju_figure_curves/opju_figure_text/opju_reports). **Not indexed in
`docs/origin_project_format.md`'s own table of contents:** `tree.py` /
`tree_opju.py` (the Project Explorer folder tree). That feature is fully
implemented, tested (`tests/test_io_origin_tree.py`), and wired into
`__init__.py::read_origin_books`'s `origin_folder_path` metadata field, but
the main format doc's TOC has no section for it — this reference describes
it from the module docstrings directly (see §5). Flagged here rather than
silently folded in as if it were already indexed.

---

## 3. Column data

### 3.1 `.opj` (CPYA) — plain fixed-width records

Every worksheet cell, **regardless of the column's declared value type**, is
the same 10-byte record: `<u16 mask><float64 value>`. There is no narrower
on-disk width for `int`/`float32` columns — they store plain IEEE754 float64
bit patterns, so they needed no special-case code at all (corpus-wide scan,
2687 column pairs, zero data blocks at any stride other than 10
bytes/record). Missing cells store the sentinel bit pattern
`0e 2c 13 1c fe 74 aa 81` (`-1.23456789e-300`, `container.ORIGIN_MISSING`),
decoded to NaN — not flagged by the mask bytes.

Source: `docs/origin_project_format.md` §3.1–3.2; `container.py::decode_doubles`.

### 3.2 `.opju` (CPYUA) — canonical Burtscher FPC

**Solved and shipping**, `opju_codec.py`. The codec is the published
Burtscher & Ratanaworabhan FPC algorithm (IEEE TC 2009) — identified, not
reverse-engineered from scratch, once the early XOR-delta/PREV-PRED
hypothesis was recognized as a special-case illusion (kept as history in
`docs/origin_project_format.md` §3.3.1). Validated bit-exact against
Origin's own ground-truth export: 210/210 oracle columns total (every
`XAS.opju` column 243/243, hundreds more across `RockingCurve`/`UnpolPlots`/
`"Fixed Lambdas SI"`/`Hc2 data`).

**Record framing:** `0a 05 <varint> ff ff <nrows:varint> 00 <segment list>`,
located by scanning for the `0a 05 <varint> ff ff` header (`0xff 0xff` also
occurs inside residual data, so the scanner's cursor jumps past each decoded
record to skip false in-stream hits).

**Segment grammar (ZigZag varint):** a negative `-m` segment means `m` FPC-coded
rows follow inline (fresh predictor state per stream); a positive `+k` segment
means `k` rows of one repeated value (a value-spec tag: `0x50`+float64,
`0x1a`/`0x11`+top-2/1 bytes, or bare `0x64`=0.0). Segments interleave freely
(the "chunked staircase" case).

**Predictors:** FCM (value predictor, `pred = fcm[fh]`) and DFCM (stride
predictor, `pred = last + dfcm[dh]`) race per value; the encoder XORs the true
bits against the closer prediction and stores the low `k` non-zero bytes. A
4-bit code (bit 3 = predictor select, bits 0-2 = residual byte-count via the
canonical FPC bcode mapping — codes 0-3 → 0-3 bytes, codes 4-7 → 5-8 bytes)
packs two-per-control-byte, low nibble first. Both hash tables are 2^12
entries; update rule:

```
fh = ((fh << 6) ^ (value  >> 48)) & 0xFFF
dh = ((dh << 2) ^ (stride >> 40)) & 0xFFF
```

Source: `opju_codec.py` module docstring; `docs/origin_project_format.md`
§3.3 for the full byte-level pinning trail (bit-flip probes, the width-rule
correction).

### 3.3 What's bit-exact vs dropped

| Family | `.opj` | `.opju` |
|---|---|---|
| int/float32 columns | bit-exact (same 10-byte record as double) | bit-exact (FPC codec) |
| "Text & Numeric" inline strings (≤7 chars) | decoded → `metadata["origin_text_columns"]` (`container.decode_inline_text`) | not a separate family — CPYUA has no equivalent fixed-width overflow shape |
| FitLinear/NLFit report-sheet `cell://...` reference strings | decoded → `metadata["origin_report_sheets"]` (`container.decode_report_strings`, a wider fixed-width record keyed by a `0x0001` mask) | decoded → `metadata["origin_report_sheets"]` (`opju_reports.scan_report_columns`, a `0x01` tag byte + ZigZag string-segment grammar — a *different* on-disk shape for the same conceptual content) |
| The fit's actual computed number (e.g. Slope = -1.5) | **not recoverable** — only the `cell://Parameters.Slope.Value` reference naming *which* statistic | **not recoverable**, same reason |
| `Moke.opj Book3_A`-style mixed text-label/numeric-sentinel column | honest drop (varies record *type* row-to-row; fits neither existing shape) | n/a — not observed in the `.opju` corpus |

Source: `docs/origin_project_format.md` §3.2, §3.4 (both `decode_report_strings`
and `scan_report_columns` module docstrings agree on the residual gap: the
reference *names* the cell, never the computed value).

---

## 4. Column metadata

### 4.1 Plot-designation markers

Origin's published worksheet plot-designation enum (0=Y, 1=disregard, 2=Y
Error, 3=X, 4=Label, 5=Z, 6=X Error) is cited as public vendor documentation,
not GPL code (`docs/origin_project_format.md` §10). Both containers encode a
subset of it directly on disk:

| Container | Location | Marker bytes → designation |
|---|---|---|
| `.opj` | column-property block, offset `0x11` (byte value = enum code directly) | `0`→Y, `1`→disregard, `2`→Y-error, `3`→X, `4`→Label*, `5`→Z*, `6`→X-error* (* inferred, not observed in corpus) |
| `.opju` | a 2-byte marker per column, reusing `.opj`'s own marker-byte + display-code convention inside CPYUA's framing | `21 51`→X, `21 61`→Y, `30 61`→Y-error (disregard/X-error unconfirmed — no oracle column exercised them; anything else falls back to plain Y) |

Source: `docs/origin_project_format.md` §4.1 (table) and §4.2;
`windows.py::_DESIGNATION`; `windows_opju.py` module docstring.

### 4.2 Column lettering / dataset naming

Both containers key worksheet data as `"<Book>_<Col>"` (e.g. `Book1_A`,
`Book1_B`, …; extra sheets append `@N`, see §5). Column letters follow
Origin's own A, B, …, Z, AA, AB, … convention. In `.opju`, association across
one book's columns is **positional** (ordinal within the book's contiguous
marker run, mapped through standard A/B/C/… lettering) — no internal
short-name field was ever found for CPYUA the way `.opj`'s property block
has one at offset `0x12`.

Source: `docs/origin_project_format.md` §4.1.1 (`.opj` rule, validated at
scale on `XMCD.opj`'s multi-char short names), §4.2 point 3 (`.opju`
positional rule).

### 4.3 Label record shape

| Container | Shape |
|---|---|
| `.opj` | a label-text block strictly follows each column-property block: `LongName\r\nUnit\r\nComment[\r\n extra…]\0[@${…}]` — split on `\r\n`, empty rows preserved, cut at `@${` before parsing. Non-ASCII bytes are Windows ANSI (latin-1), e.g. `325 \xb0C` = `325 °C`. |
| `.opju` | a fixed-shape run of default column-format doubles follows every designation marker, then an OPTIONAL length-prefixed embedded blob (imported-file `ColumnInfo`/`ImportFile` storage), then the label record itself: `<len:u8><tag:u8><text…><NUL>` — `text` splits on `\r\n` into long_name/unit/comment (0-3 rows); zero-length text means "no label". |

Source: `docs/origin_project_format.md` §4.1 ("Label-text block") and §4.2
point 2 (with worked examples from `XAS.opju`/`UnpolPlots`/`rosetta_min`).

### 4.4 Book anchoring

`.opj` anchors a column-property list to its book via the window-header
block that opens each worksheet window (`00 00 <BookShort> 00 …`). `.opju`
has no such single anchor field; instead each book's marker run is anchored
via one of two independent signals — (a) the embedded `ColumnInfo`/
`ImportFile` path's filename, alnum-stripped and matched to the book's short
name, or (b) a `<len=namelen+2> 00 00 <name>` window/book-header reference
present even for books never imported from a file. When neither anchor is
found, the book is left out of the metadata entirely (A/B/C designation
fallback) rather than guessed at.

Source: `docs/origin_project_format.md` §4.2 points 4; `windows_opju.py`
module docstring.

### 4.5 Corpus validation (`.opju` names/units/comments)

| file | names | units | comments |
|---|---|---|---|
| XAS | 6/6 | 6/6 | 3/3 |
| RockingCurve | 8/8 | 8/8 | 3/3 |
| UnpolPlots | 23/23 | 2/2 | 1/1 |
| "Fixed Lambdas SI" | 108/108 | 108/108 | 10/10 |
| rosetta_min/lname/2books | 2/2 each | 2/2 each | — |
| **total** | **151/151** | **130/130** | **17/17** |

Source: `docs/origin_project_format.md` §4.2 corpus table (validated
through the shipped `read_origin_books`).

---

## 5. Books / sheets / folder tree

### 5.1 Sheet hierarchy (`Book@N` pseudo-books)

Extra sheets (sheet index ≥ 2 within one book) surface as separate
pseudo-books, not a nested Book→Sheet tree — a deliberate UI descope. The
naming convention marks them directly: dataset name `"<Book>_<Col>@<N>"`;
`opj.py::_group_named` splits on `@` and renames the pseudo-book
`"<Book>@<N>"`, with display title `"<Book long name> (sheet N)"`. Only the
**primary sheet** gets real names/units — sheet 2+ falls back to the plain
Origin short designation (A, B, C, …).

Source: `docs/origin_project_format.md` §5.

### 5.2 Empty report-book gating

Origin fit/report sheets surface as pseudo-books whose numeric `.values` are
empty (their content is unresolved `cell://` reference stubs in
`metadata["origin_report_sheets"]`). Listing them as top-level Library
entries would flood it with empty rows (48 `Book2@N` fit-report shells on
the Hc2 project alone) — `drop_empty_library_books` (`__init__.py`) hides
any book with no plottable numeric data AND no text content, applied as a
presentation gate at the import boundary (never inside the decoder itself,
mirroring `drop_nonactionable_figures`). Text-only books are kept; a
degenerate all-empty project passes through unchanged so the Library still
shows something.

Source: `__init__.py::drop_empty_library_books` docstring.

### 5.3 Project Explorer folder tree

**Not indexed in `docs/origin_project_format.md`'s table of contents** — a
real, separately-implemented, separately-tested feature described here
directly from its module docstrings and `tests/test_io_origin_tree.py`.

This is *which Project Explorer folder each window lives in* (`origin_folder_path`
metadata), distinct from §5.1's sheet hierarchy. `.opj` and `.opju` each get
their own module (`tree.py`, `tree_opju.py`) because the on-disk shape
differs completely, but both build the same recursive `_FolderNode` /
`_flatten` structure and both fail closed (`{}` / empty path) on any framing
mismatch rather than guessing.

**`.opj` (`tree.py::opj_folder_paths`) — SOLVED, general (not sample-tuned).**
After the datasets+windows block stream (§2's `walk_blocks` boundary), the
tail holds a params section, a project record, a notes list, then the root
folder record recursively:

```
folder := <hdr32: 32B, zeros + 2 f64 dates>
          NULL
          <name-block: NUL-terminated folder name>
          <bare u32 LE == 2><0x0A>          -- fixed marker, no payload
          <attrs block>  <storage block>    -- sizes vary; skipped as-is
          <nwin: u32>
          {NULL <8-byte (u32 flags, u32 ordinal)> NULL} * nwin
          <nsub: u32>
          {folder} * nsub                   -- recursion; no root closer
```

Windows are referenced by their **0-based ordinal into the file's window-header
stream order** (every worksheet AND graph window counts) — never by name or
offset. Validated byte-exact (0 mismatches) against the full window→folder-path
mapping COM reports for 7 structurally diverse real projects (611 windows
total): trivial flat layouts, root-level windows mixed with folders, 4-5
levels of nesting with duplicate folder names at different parents and empty
intermediate folders, both CPYA sub-versions (4.3227/4.3380).

A window-name-enumeration hazard was found and fixed: window short names can
legitimately start with a digit (`"30nmADPNR"`), and a byte-shape scan can
also collide with an ordinary data-block that happens to start `00 00` and
look printable — requiring the extracted name to fully match
`[A-Za-z0-9][A-Za-z0-9_-]*` resolves both (found via `MnN_Diffusion_PNR.opj`'s
digit-led graph names and `hc2convert.opj`/`XMCD.opj`'s false-positive
collisions).

**`.opju` (`tree_opju.py::opju_folder_paths`) — SOLVED for both known
container sub-versions** (4.3811, what OriginPro 2026b writes, and the older
4.3380 corpus). Reuses `.opj`'s name-block framing but has its own
everything-else: `<name-block> <attrs/storage> <2*nwin> [00] {window-entry}
<2*nsub> {SEP <16 date bytes> subfolder}`, where a window entry is `80 01 85
00` (ordinal 0) or `80 04 81 <len> <ordinal LE> 80 00` (ordinal ≥ 1). Window
pages are enumerated via the `0a`-framed page header `0A [00] 80 <type>
<namelen+2> 00 00 <name> <hi>` (`_OPJU_WIN_RE`, also reused by
`opju_figure_curves.py` for page-span scoping — see §6.1). The tree is
rebuilt from preorder + per-folder child count (a structural invariant,
robust to arbitrary depth/empty folders/duplicate or unicode names).
Validated byte-exact vs live COM on all 5 corpus files (including the 39-book
`Hc2 data` with report-table windows and nested folders) plus 11 controlled
4.3811 specimens.

**Scope note:** the `Book@N` sheet-suffix numbering (§5.1) is validated for
the common case but not exhaustively pinned; folder-tree recovery (§5.3) is
independently validated general — the two are separate features and neither
gap in one implies a gap in the other.

Source: `tree.py` and `tree_opju.py` module docstrings; `tests/test_io_origin_tree.py`.

---

## 6. Figures

Both readers emit a flat list of plot-state snapshot dicts (`name`, `layer`,
`x_from`/`x_to`/`x_log`, `y_from`/`y_to`/`y_log`, `source_hint`, `n_curves`,
`curves`, `annotations`) — **one dict per LAYER, not per window** — shipped
in the import payload and surfaced in the frontend's Library "Figures"
section (`frontend/src/components/Library/FiguresSection.tsx`).

Source: `docs/origin_project_format.md` §6.3.

### 6.1 Curve bindings

This is the "which exact columns does this curve plot" problem — the
hardest-won part of the whole subsystem. Both containers are now solved at
high precision; the state below **supersedes** any older recall numbers
still visible in `docs/origin_project_format.md`'s §11 "Open items" section
(see the contradiction flagged at the end of this subsection).

**`.opj` — solved 2026-07-04 (item 11, `opj_curves.py`).** Immediately
before each curve's DataPlot style+body pair sits a small anchor record:

```
01 00 00 00  <id:u16 LE>  00 01 00 00  00 00 a1 00  ...
```

The `u16` is the plotted column's own **global, project-wide, monotonically-
assigned serial id** — the same id independently stamped in that column's
own workbook-storage block, at the identical offset (4, u16 LE). Book and
column resolve together via this one id (ids are never restarted per book).
X is a **structural inference** (the book's own designated-X column, falling
back to the sheet's first column) — not verified against any oracle.
Validated: 100% precision on every reachable curve; 45/70 (64.3%) of the
combined Moke+XRD oracle, the 25-ref shortfall entirely two structurally
out-of-reach window kinds (FitLinear auto-report graphs with no window
header; per-column worksheet sparklines), not undecoded curves.

Source: `docs/origin_project_format.md` §6.1.1; `opj_curves.py` module
docstring; `tests/test_io_origin_figures_opj_curves.py`;
`tools/origin_trial/score_curve_bindings_opj.py`.

**`.opju` — the global column-id table (2026-07-05 rework, `opju_figure_curves.py`),
CLOSED.** The two earlier token "families" (`opju_curves.py`'s `0x03`
subtype, `opju_curves_allcols.py`'s `0x01` subtype) both decoded by
*counting columns* — this was falsified by the Hc2 project (heavily edited:
columns added to early books after later books existed) and replaced by the
real semantics: the token value is the plotted column's own global,
project-wide, **creation-order serial id**, not an ordinal to count:

```
<flag:1> 01 01 01 80 <width:01|03> <payload>
    width 0x01 -> <id:u8>
    width 0x03 -> <id:u16 LE> <flag:1>     (3rd byte varies, not id)
```

The id is stored in every worksheet column's own windows-section record, two
forms (form A common, form B rare — never overlapping id sets):

```
form A:  80 <serial> 01 10 80 03 <id:u16 LE> <pb> <fields…>
form B:  80 <serial> 07 10 01 00 00 <id:u16 LE> <pb> <fields…>
```

`<fields…>` are tagged `<tag:0x80-0x9f> <len> <payload>` runs: the column's
short name, a fixed separator, then the field whose payload tail is the §4.1
designation marker — a Y column's marker field additionally stores its
designated **X partner column's id** (validated: Hc2's `Derivative Y1`
column pairs with `Derivative X1`, not column A). Records attribute to their
book by containing **page span** (the `0a`-framed page headers `tree_opju`
validated byte-exact vs COM) — this also recovers each figure's real window
name and kills cross-window attribution leaks. The old counting decoders
remain only as a fallback for id-table-less streams (synthetic fixtures,
templates).

**Validation (2026-07-05):** file-level `plots.json` oracle: 36/36 pairs
decoded, 0 wrong (7 stems). Per-graph `index.json` oracle (`Hc2 data`, the
first stem whose export populated `graphs[].layers[].plots`): 7 of 8
oracle graphs that exist as real graph pages bind exactly, 0 wrong anywhere.
One documented negative: `Graph5` (a duplicate-window graph) carries no id
token at all — decodes to `curves == []`, never guessed.

Source: `opju_figure_curves.py` module docstring (§6.2.2 of
`docs/origin_project_format.md`); `tests/test_io_origin_figures_opju.py::
test_realdata_curve_bindings_vs_plots_oracle`,
`test_realdata_hc2_per_graph_bindings_vs_index_oracle`;
`tools/origin_trial/score_curve_bindings.py`.

**⚠ Internal inconsistency flagged, not silently resolved.**
`docs/origin_project_format.md` §11 "Open items" still carries two
`.opju`-item-35 entries dated 2026-07-04 quoting **30.6% aggregate recall**
and describing per-figure attribution and "the third encoding" as open
problems. §6.2.2 (dated 2026-07-05, i.e. later) supersedes this: the
id-table rework raised aggregate recall to **100% (36/36)** and resolved
per-figure attribution via page-span scoping. This document uses the
2026-07-05 §6.2.2 numbers as current; the stale §11 entries were apparently
not rewritten after that rework landed. Treat `docs/origin_project_format.md`
§6.2.2 (and `opju_figure_curves.py`'s own docstring) as authoritative over
its own §11 for this item.

### 6.2 Axis ranges + scale flags

**Axis range** — a `float64 (from, to, step)` triple at fixed
`.opj` layer-continuation-block offsets: X @15/@23/@31, Y @58/@66/@74.
Validated across 4 files / 37 graphs, zero misparses.

**Y-scale (lin/log) — exact in both containers.** `.opj`: 2 bytes at payload
offset 98/99, `01 00` = linear, `08 01` = log10 (`figures.py::_y_scale_flag`).
`.opju` real-corpus form: the 2 bytes immediately before a fixed 4-byte
layer-style marker `00 10 10 00`, same two byte values in the same order
(`opju_axis_real_form.py::_real_y_log_flag`). Independently discovered in
each container, cross-validating each other as a real dedicated field rather
than coincidence. Validated against >300 `.opj` layers corpus-wide and 14
real-corpus `.opju` anchors, plus a 4-file by-construction oracle
(`rf_linlin`/`rf_logx`/`rf_logy`/`rf_loglog.opju`) that isolated the flag
from the axis geometry payload entirely.

**X-scale — exact in `.opju` (both record forms, solved 2026-07-06); still
(heuristic) in `.opj`.** Isolated by pairwise byte-diffs of the same rf_*
quad (`rf_logx` vs `rf_linlin`, `rf_loglog` vs `rf_logy` — each pair differs
only in `layer.x.type`): the geometry payload between an axis record's two
separators ENDS with an X-scale field carrying the same two byte values as
the Y flag — `01` = linear, `08 01` = log10 — immediately before the Y
span's first token, with 0-2 trailing `00` pad bytes in between
(`opju_axis_real_form.py::_real_x_log_flag`, read backward from the decoded
Y-span start). In the *specimen* form the same field is the tail of the
"`7b 40 01` filler" after the combined scale byte (really `7b 40` + the
flag; `figures_opju.py::_parse_specimen_record`) — it is what encodes X when
the combined byte reads `0x0d` = Y-log (that byte carries no X info; the
tempting "0x0e = both-log" guess was tested and is **false** — both-log is
`0x0d` + flag `08 01`, resolved by `fig_xylog`/`rf_loglog`). Corpus proof:
all 9 by-construction log/lin specimens exact; the one REAL log-x graph,
`Fixed Lambdas SI!Graph6` (2 panel layers, GT `layer.x.type=2`, a 3.8x span
the decade heuristic mislabels linear), reads `08 01`; every GT-linear real
record (~70 across Hc2/RockingCurve/XAS/UnpolPlots/Fixed Lambdas) reads
`01`; zero false positives. Six Hc2 records carry an unrecognized `02` in
the field — those return `None` and keep the heuristic (never guessed).

The heuristic (an axis reads log10 when `from > 0` and `to/from ≳ 10^3`
with an integer `step`) remains for: (a) `.opju` records whose field is
unrecognized, and (b) **all `.opj` layers** — no `.opj` log-x graph exists
in the corpus to diff against, and one cannot be generated: the trial
Origin only writes CPYUA (`app.Save` and LabTalk `save -d` both silently
save `.opju` regardless of a `.opj` extension, attempted 2026-07-06). A
candidate `.opj` X flag near the Y flag at offset 98/99 therefore cannot be
isolated from constants on an all-linear corpus; the honest boundary is
heuristic-only there.

Related (2026-07-06): panel/composite multi-layer windows anchor per-layer
records with `03 00 00 5f` (= `1f | 0x40`), and Fixed Lambdas' panel layers
encode Y spans as bare 8-byte LE literals — decoded via a last-resort bare
retry accepted only where the X-flag bytes authenticate the Y-span start.
This is what surfaced the previously-undecodable Graph5/Graph6 (and the
RockingCurve/UnpolPlots `Graph3` composite) layers.

Source: `docs/origin_project_format.md` §6.1 ("Axis range", "Y-scale type"),
§6.2 (specimen form combined flag, real form Y flag); `figures.py`,
`figures_opju.py`, `opju_axis_real_form.py` module docstrings.

### 6.3 Axis-title / legend / annotation routing

**`.opj` — solved 2026-07-05.** Every graph-child object (axis title,
legend, floating annotation) shares the **133-byte object header** (also used
by curve anchors, §6.1), carrying the object's own name as a NUL-terminated
ASCII cstring at fixed payload offset 70. Object names and their bucket:

| Name(s) | Bucket |
|---|---|
| `YL` | `y_title` |
| `XB` | `x_title` |
| `YR` | `y2_title` |
| `Legend` | `legend_labels` (parsed per curve from `\l(n) <label>` lines) |
| `Text`/`TextN`/`Line`/`LineN` | `annotations` (floating text/line) |
| `__LayerInfoStorage`/`__BCO2`/`__FRAMESRCDATAINFOS`/`3D`, `OB`/`OL`/`OR`/`X1`/`X2`, `Rect*`/`Circle*`, `RLX*`/`RLY*` | not routed (internal storage, axis-break sub-objects, shapes, reference lines) |

`_build_layer` tracks which named object is "current" while walking a
layer's block span and routes each recovered text run to that bucket; every
other/unresolved header switches to "ignore" (so a curve's own style body
never inherits the previous object's bucket). Before the first header (or if
none resolves), the bucket defaults to `annotations` — the historical
flat-scrape fallback.

**`.opju` — solved 2026-07-05, same buckets, different framing**
(`opju_figure_text.py`). CPYUA carries the SAME named child objects in a
tagged name-header + framed-text grammar instead of the fixed 133-byte
header:

```
object-name header (axis-title shape):  <tag 80-9f> 04 10 00 00 <xx> <ntag> <nlen> <name>
object-name header (Legend/Text shape): <tag 80-9f> 01 10 <ntag> <nlen> <name>
text content:                            <tag> 01 80 <tlen> <text … 00>
```

Text is UTF-8 in `.opju` (e.g. `H\-(c2⊥) (T)`, raw multi-byte `∥`/`⊥`) where
the ANSI `.opj` container stores `\(x22A5)`-style escapes for the same
content instead (§7). Pairing is sequential: a text run pairs with the
nearest preceding unconsumed name header (name→text distance measured 49-66
bytes corpus-wide, bounded generously at 512); an unpaired text defaults to
`annotations`, same fallback as `.opj`. Routing reuses `figures.py`'s
`_object_bucket`/`_first_title`/`_parse_legend_labels`/`_clean_annotations`
verbatim so both containers' cleanup pipelines cannot drift.

**Validated:** 323 name→text pairs across the 5-file real `.opju` corpus, 0
orphan texts, and — the strongest check — every graph shared between
`Hc2 data.opju` and its `hc2convert.opj` Save-As conversion routes to
identical titles.

Source: `figures.py` module docstring (axis-title/legend routing section);
`opju_figure_text.py` module docstring.

### 6.4 Annotation positions (confirmed model)

**Status: LANDED (`170b46e`) and oracle-verified 5/5 (worst residual
5.6e-17).** Both containers emit `annotation_marks: [{text, x, y}]` on every
figure dict; the formula + both reads live in the pure leaf
`io/origin_project/annotation_marks.py`. The frontend
(`lib/originFigures.originFigureAnnotations` + `applyOriginFigure`) maps
marks onto the plot's data-coordinate `Annotation[]`.

**The existing, already-documented foundation:** the 133-byte object header
(§6.3) stores an object's position as two `float64`s at payload offsets 19
and 27; axis-title objects carry it in **data coordinates**, while text
annotations carry **normalized (0-1) layer-fraction coordinates** — this much
was already pinned in `docs/origin_project_format.md` §6.1 ("Object name is
an ASCII run near offset ~64; two floats at offsets 19 and 27 hold its
position").

**The confirmed refinement (2026-07-05, `export_annotation_oracle.py` +
conversation):** free-text label objects store their **top-left box
corner** as two float64 layer-fractions `(fracA, fracB)`, with `fracB`
(the y-fraction) measured **from the top** of the layer. Converting to data
coordinates:

```
x1 = x_from + fracA * (x_to - x_from)
y1 = y_to   - fracB * (y_to - y_from)
```

Verified 5/5 exact against `export_annotation_oracle.py`'s COM-captured
`annotations.json` output (`{name, text, x, y, attach, x1, y1, x_from, x_to,
y_from, y_to}` per text object) — comparing decoded `(x, y)` to the oracle's
`x1`/`y1` (the box top-left; the oracle's `x`/`y` is a different anchor). A
multi-line annotation is captured as ONE `\r\n`-joined `Text` object by
Origin (kept as one mark, `\r\n`→`\n`).

**Where the fraction pair lives (both containers, `annotation_marks.py`):**
- `.opj`: 133-byte object-header payload offsets **+19 (fracA)** / **+27
  (fracB)** — the same fields §6.1 already names.
- `.opju`: a tagged field `85 13 <fracA:8 LE> <fracB:8 LE> 80 00 …` ending
  **exactly 32 bytes before** the object-name header `opju_figure_text`
  already locates (fracA at h−30, fracB at h−22, `80 00` boundary at h−14 as
  a guard). Confirmed at that distance for every positioned Text across the
  5-file real `.opju` corpus.

**Fail-closed omissions (never guessed):** two `.opju` tag variants without
oracle coverage — RockingCurve's `86 13` composite panel labels and one
UnpolPlots `85 1f` — and any implausible fraction (`|frac| > 50` or
non-finite) ship their text in `annotations` with no position. Open caveats:
the linear frac→data formula is applied on log-scaled layers too (no
log-axis oracle instance exists to check that case), and the canvas render
is jsdom-unverifiable.

**Why the oracle captures both the raw value and the attach mode.**
`export_annotation_oracle.py` records `obj.attach` (0=page, 1=layer/data
units, 2=layer-frame fraction) alongside `obj.x`/`obj.y` precisely so the
verifier — not the capture script — decides the coordinate mapping; this is
why the oracle is trustworthy evidence for the formula above rather than a
guess baked into the capture itself.

**Caveat carried from §8:** this oracle is subject to the same student/eval
COM page-limit truncation as every other COM-captured oracle (§8) — it is
authoritative for the annotation objects it lists, not a completeness
measure.

Source: `io/origin_project/annotation_marks.py` (formula + both container
reads); `tools/origin_trial/export_annotation_oracle.py` (the COM oracle
capturer, incl. the `exist(name,16)` graphic-object check);
`tests/test_io_origin_annotation_marks.py` (the 5-instance realdata
verification at 1e-6 abs); frontend `lib/originFigures.ts` +
`store/useApp.ts` (`applyOriginFigure`).

### 6.5 `.opj` vs `.opju` framing differences, at a glance

| Aspect | `.opj` (CPYA) | `.opju` (CPYUA) |
|---|---|---|
| Container framing | `<u32 size><0x0A><payload><0x0A>` walkable block stream (`container.py::walk_blocks`) | no generic walker; each subsystem locates its own records directly (LEB128-varint columns, `0a`-framed pages, 4-byte figure anchors) |
| Graph layer anchor | window-header block + layer-continuation block (`00 00 1f 00` / `00 00 17 00`) | 4-byte marker `03 00 00 1f` |
| Object header | universal 133-byte header, type tag at payload offset 2 | tagged name-header + framed-text grammar (no fixed-size header) |
| Curve selector | per-curve global column id anchor before the DataPlot | tagged-width global column id token + a global id table stored per-column |
| Window/graph name recovery | direct (window header supplies it) | recovered indirectly via `0a`-framed page names (post-2026-07-05 id-table rework); previously always `""` |
| String encoding | ANSI/latin-1 + backslash escapes for non-ANSI chars (`\(x22A5)`) | native UTF-8 |

Source: synthesized from `docs/origin_project_format.md` §2, §6.1, §6.2,
§6.5 (Origin→quantized mapping table) and the module docstrings cited above.

---

## 7. Rich text

Origin stores axis titles, legend labels, and annotations with inline
LabTalk "text object" escapes. `origin_richtext.py::clean_richtext` decodes
the display-affecting ones:

| Escape | Meaning |
|---|---|
| `\g(...)` | Symbol-font run → Greek letters (`\g(q)` = θ) |
| `\(NNN)` | insert character by decimal code |
| `\(xHHHH)` | insert character by hex code — Origin's Unicode form (how `.opj` Save-As stores non-ANSI chars, e.g. `\(x2225)` → ∥) |
| `\+(...)` / `\-(...)` | superscript / subscript → Unicode super/subscript chars |
| `\b(...)` `\i(...)` `\u(...)` `\f:Font(...)` `\c<n>(...)` | bold/italic/underline/font/colour → styling dropped, inner text kept |
| `%(...)` | data-reference substitution (e.g. `%(2)` = "dataset 2's name") — left untouched, it is a reference, not display text |

Handling is total and safe: strings with no `\` return unchanged, and any
parse error (unterminated run, etc.) degrades to the raw input rather than
partially transforming it.

```python
>>> clean_richtext("2\\g(q \\(40))degrees)")
'2θ (degrees)'
```

Source: `origin_richtext.py` module docstring + doctest;
`docs/origin_project_format.md` §"Axis titles" (escape table cited as public
OriginLab syntax, not GPL code).

---

## 8. COM oracle methodology

All ground truth in this subsystem comes from Origin's own COM automation
(`Origin.ApplicationSI`), scripted from Python via `win32com.client` and a
`LTStr`/`LTVar`/`Execute` bridge — never from GPL `liborigin` source.

### 8.1 The bridge pattern

```python
app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
app.Visible = 0

def lt(cmd: str) -> bool:
    return bool(app.Execute(cmd))          # run a LabTalk statement

def lt_str(expr: str) -> str:
    lt(f"string __s$ = {expr};")
    return str(app.LTStr("__s$"))          # read a LabTalk string var back

def lt_num(expr: str) -> float:
    lt(f"double __d = {expr};")
    return float(app.LTVar("__d"))         # read a LabTalk numeric var back
```

Source: `tools/origin_trial/export_ground_truth.py`,
`export_hc2_oracle.py`, `export_annotation_oracle.py` (all three use this
identical pattern).

### 8.2 LabTalk idiom cookbook (what actually works)

| Goal | Idiom | Notes |
|---|---|---|
| Enumerate all workbook/graph windows | `doc -e W { … }` / `doc -e P { … }` accumulating into a string var | The COM collections (`WorksheetPages`/`GraphPages`) iterator throws — never use them directly |
| Enumerate a page's layers | `for (li = 1; li <= page.nlayers; li++) { page.active = li; … }` | — |
| Get a per-plot dataset reference | `range -w __rp = {pi}; "%(__rp)"`, probing `pi` upward until the substitution stops yielding fresh non-`###` text | The naive `range __rp = {pi}` (no `-w`) is a **column**-range form and never binds a data plot — this returned empty `"plots": []` for every project the first time it was tried; `-w` (plot range in the active layer) is the working recipe |
| Read an axis title | `xb.text$` / `yl.text$` | `layer.x.label.text$` returns the literal string form, **not** the value — use the named object's `.text$` instead |
| Test whether a graphic object exists | `exist(name, 16)` | Type code 16 = GRAPHIC object; `exist(name)`/`exist(name,1)`/`exist(name,8)` all return 0 even when the object exists — confirmed by diagnostic comparison |
| Read a text-annotation position | `{name}.x`, `{name}.y`, `{name}.attach`, `{name}.x1`, `{name}.y1` | Capture BOTH the raw value and `.attach` (0=page,1=layer/data,2=layer-fraction) — let the verifier decide the coordinate mapping, don't bake in an assumption at capture time |
| Get a worksheet cell/column value | `expASC` (ASCII export) | `GetWorksheet` always returns `DISP_E_TYPEMISMATCH` via pywin32 — don't fight it, export instead |
| Accumulate a string across repeated `Execute` calls | `__s$ = "%(__s$)%H|";` (with an explicit `%()`-substitution + separator) | Plain concatenation across `Execute` calls silently drops content without the `%()` substitution quoting |

Source: `tools/origin_trial/export_ground_truth.py` (COM-gotchas block),
`export_hc2_oracle.py`, `export_plot_refs.py`, `export_annotation_oracle.py`
module docstrings; `docs/origin_re/validation_log.md` (2026-07-04 "per-plot
oracle regenerated" and "item 25 live verification" entries).

### 8.3 Oracle file formats

| File | Written by | Shape |
|---|---|---|
| `specimens/ground_truth/<stem>/index.json` | `export_ground_truth.py` (+ `export_hc2_oracle.py` merges into the `"graphs"` key for large projects) | `{"books": [{"book","long_name","sheets":[{"sheet","nrows","columns":[{"dataset","long_name","unit","comment"}],"csv"}]}], "graphs": [{"graph","long_name","layers":[{"x":[from,to,type],"y":[from,to,type],"plots":[ref,...],"x_title","y_title"}]}]}` |
| `specimens/ground_truth/<stem>/<Book>_s<sheet>.csv` | `export_ground_truth.py` (`expASC`) | long-name row + unit row + full-precision data, one CSV per sheet |
| `specimens/ground_truth/<stem>/plots.json` | `export_plot_refs.py` | `{"<graph>": {"<layer>": ["[Book]\"Sheet\"!Col\"LongName\"", ...]}}` — every `(book, column)` pair a project plots anywhere; the strongest oracle for file-wide curve-binding scoring |
| `specimens/ground_truth/<stem>/annotations.json` | `export_annotation_oracle.py` | `{"<graph>": [{"layer","name","text","x","y","attach","x1","y1","x_from","x_to","y_from","y_to"}, ...]}` |

All of these live under `../test-data/origin/` (sibling directory, never
committed, never pushed) — real Origin projects may hold private research
data.

Source: each script's own docstring; `docs/origin_project_format.md` §9.

### 8.4 The hard caveat: student/eval COM page-limit truncation

Origin's page-limited student/eval license can enumerate **fewer** graphs
than a binary actually contains (the Hc2 `.opj` binary has `Graph1..34` +
`FitLine*`/`Residual*`, but `doc -e P` returned only 40 total across both
files tested, and even that was inconsistent run-to-run). Every oracle
script built on `doc -e P`/`doc -e W` inherits this ceiling. **The
consequence that matters:** these oracles are authoritative for the
bindings/annotations/graphs they *do* list — every entry that appears is
real ground truth — but they are **not a completeness measure**. Never
compute a recall denominator from "the oracle didn't list it" as if that
proved the file doesn't contain it; only compute recall against pairs the
oracle actually enumerates, and never claim more coverage than that.

Source: `export_hc2_oracle.py` and `export_annotation_oracle.py` module
docstrings (both state this explicitly, in near-identical wording, as a
load-bearing caveat); `docs/origin_project_format.md` §6.2.2's validation
table (explicitly marks unmatched decoded graphs as "unverifiable", never
"wrong").

---

## 9. Verification & discipline

**Markers.** `@pytest.mark.golden` compares against frozen MATLAB reference
values (not primarily an Origin-subsystem marker); `@pytest.mark.realdata`
needs the local-only `../test-data/origin/` corpus and auto-skips when
absent, so CI and other machines stay green. Registered in `pyproject.toml`'s
`[tool.pytest.ini_options]`.

**Same-project cross-container checks.** Several files in the corpus exist
as both a native `.opj` and an `.opju` Save-As conversion of the same
project (`hc2convert.opj` / `Hc2 data.opju`). These are used as an
independent cross-check: a "same window-state" predicate (matching axis
ranges AND curve sets, not just a name match) confirms a decoded figure in
one container is the same figure as in the other — this is how the axis-title
routing claim in §6.3 gets its strongest validation (identical titles on the
shared graph across both containers) and how the Y-scale flag's discovery in
`.opju` cross-validated the independently-discovered `.opj` flag (§6.2). A
loose predicate (name-only) would be too weak here since `.opju` often can't
recover a window's original name at all (§6.5).

**Fail-closed is the load-bearing design principle across every decoder in
this package:**
- an id claimed twice with different `(book, column)` in the global column-id
  table is *poisoned* (removed entirely), never guessed (`opju_figure_curves.py::column_id_table`);
- a record whose fields don't resolve is skipped, not partially decoded;
- an unresolvable curve token is dropped, never attached to the wrong column;
- a folder-tree framing mismatch returns `{}` (flat import), never a
  best-guess partial tree;
- a wrong binding/title/position is considered **strictly worse** than a
  missing one throughout this subsystem — every "solved" claim above is
  qualified by its measured precision (nearly always 100%) separately from
  its recall (which varies, and is always reported honestly when < 100%).

Source: `opju_figure_curves.py::column_id_table` docstring; `tree_opju.py`
module docstring ("Fail-closed: … returns `{}`"); the repeated
precision-vs-recall framing throughout `docs/origin_project_format.md` §6.

---

## 10. Known negatives / NOT decoded

Specific, honest gaps — pulled directly from module docstrings and tests,
not inferred:

- **`FitNLCurveN!B`-style fit-curve overlays are not token-encoded anywhere
  in the `.opju` byte stream.** Confirmed absent, not merely unfound.
  (`opju_figure_curves.py` module docstring, "Validation" bullet list.)
- **`Graph5`-style duplicate-window graphs carry no curve id token at all**
  in `.opju` — a `90 00 80 <tag> 01 89` byte sequence that superficially
  matches the true column id (137) is style boilerplate present on every
  graph page corpus-wide, chased and explicitly refuted as a coincidence.
  (`opju_figure_curves.py` module docstring.)
- **The fit's actual computed value** (e.g. Slope = -1.5) is not recoverable
  in either container — only the `cell://Parameters.Slope.Value`-style
  reference naming *which* statistic a report cell represents. Checked
  directly against `fitreport2.opju`'s known values (9.5/-1.5) in both raw
  and FPC-compact encodings; no match found anywhere nearby. (§3.2, §3.4.)
- **`Moke.opj Book3_A`'s mixed text-label/numeric-sentinel column** — one
  real-world worksheet-label family (varying record *type* row-to-row, not
  simply width) fits neither `decode_inline_text` nor `decode_report_strings`;
  an honest, documented drop. (§3.2.)
- **The native `.opj` writer does not load in real Origin** (`writer.py`).
  Round-trips through quantized's own reader (CI-tested) but fails
  Origin's own COM `app.Load` — confirmed 2026-07-04 via live trial. The
  two-phase loader model (stream parse builds pages; tail must parse to the
  exact last byte AND be stream-consistent) is documented in
  `docs/origin_re/validation_log.md` but the exact missing coupling is still
  unidentified. **Do not represent this writer's output as "opens in
  Origin" to users** — the Origin-ASCII + `.ogs` path is the one that
  reliably does (`docs/opening_origin_files.md`).
- **X-scale type is heuristic in `.opj`** (decade-range test): no `.opj`
  log-x oracle exists and the trial Origin cannot write old-format projects
  to make one, so the `.opju` flag's `.opj` twin (if any) cannot be
  isolated. `.opju` X-scale is EXACT since 2026-07-06 except where the
  flag field reads an unrecognized value (six Hc2 records read `02`). (§6.2.)
- **`.opju`'s per-layer window *name*** was `""` prior to the 2026-07-05
  id-table rework and is now recovered only for pages that own no column
  records (graph pages) — a report/fit-embedded figure with no page name
  still ships on an unnamed figure. (`opju_figure_curves.py` module
  docstring, "Embedded fit-report graphs" bullet.)
- **Templates (`.otp`/`.otpu`)** — same CPY family, not yet reverse-engineered
  as a style-preset source (`docs/origin_project_format.md` §11, plan item 21).
- **Analysis-log structured parsing** — the results log (§7 of the format
  doc) ships as raw text; parsing its fit records into structured metadata
  is still open (`docs/origin_project_format.md` §11, plan item 22).
- **Full sheet-hierarchy UI** (nested Book→Sheet trees) — out of scope by
  design, not a decode gap; extra sheets surface as flat `Book@N`
  pseudo-books instead (§5.1).
- **Multi-layer free layout rendering** — Origin allows N independently
  positioned/sized layers; every layer's data IS recovered (§6, item 36
  closed), but quantized's plot surface only renders single-plot + stacked
  panels + one inset, so >2 layers or non-stacked overlays are lossy *to
  render*, not to decode.
- **Rich text per-run styling** (font/color/size beyond the escapes §7
  handles) — best-effort escape→Unicode transform, dropping per-run
  styling info Origin itself would render.

Source: as cited inline above; consolidated from `docs/origin_project_format.md`
§6.3 ("Permanent gaps") and §11 ("Open items"), and the individual module
docstrings' own "known negatives" callouts.

---

## 11. RE pitfalls & lessons

Traps that cost real time during this reverse-engineering effort, so a
future session doesn't re-hit them:

- **Headless-COM silent hang / page-limit truncation.** A page-limited
  student/eval Origin license can silently enumerate fewer windows than a
  project actually contains, and an invisible (`app.Visible = 0`) instance
  can wedge on a modal dialog with no visible symptom. Always taskkill
  zombie `Origin64.exe` before starting a new COM script, and never trust an
  oracle's enumeration as a completeness measure (§8.4).
- **A `.labels`/`nrows` count mismatch that LOOKS like data loss, but isn't.**
  Origin's `wks.nrows` reports **allocated** rows (e.g. 32 for a 4-row
  `PutWorksheet`), not filled ones — comparing against `nrows` directly
  looks like massive data loss when the real fill count is fine. Compare
  filled cells, never raw `nrows`. (`docs/origin_re/validation_log.md`,
  "2026-07-04 (item 25 live verification)".)
- **An elegant additive codec model that measured FALSE.** The tempting
  guess that the `.opju` combined axis-scale byte is additive (`0x03`
  both-lin, `0x04` X-log, therefore `0x0e` "should" mean both-log) was
  directly tested against a by-construction both-log specimen and is
  **false** — the real value is `0x0d`, and once Y is log, X's state is
  simply not encoded in that byte at all. Never assume a flag byte is a
  bitfield without testing every combination it implies. (§6.2.)
- **Axis-retype re-renders the whole record, so byte-diffing before/after is
  useless for isolating a single field.** Changing an axis from linear to
  log doesn't toggle one flag byte in place — it can shift the surrounding
  record's shape enough that naive byte-diffing two saves of "the same"
  graph produces noise across the whole record instead of a clean
  single-byte diff. The working method instead was controlled specimen
  *pairs* that differ in exactly one LabTalk property (`layer.x.type`), with
  the flag isolated by a fixed anchor marker (the `00 10 10 00` layer-style
  marker) that survives the retype, not by raw position. (§6.2, "Y-scale
  flag — solved 2026-07-04" in `figures_opju.py`.)
- **LabTalk has no backslash escape.** An escaped `"\""` inside a LabTalk
  string lands literally (the backslash is not consumed) — quoted content
  containing double quotes must downgrade to single quotes before being
  embedded in generated LabTalk, not escaped. Found live while verifying
  `send_to_origin`. (`docs/origin_re/validation_log.md`, "2026-07-04 (item 25
  live verification)".)
- **`.ogs`/`impASC` export gotchas found only by actually running the script
  in Origin** (text-parity vs. MATLAB is not sufficient — it can pass while
  the script never successfully runs):
  - `impASC ... options.SkipRows.Count:=2` is **invalid LabTalk** in this
    Origin build and aborts the entire import silently; bare `impASC
    fname:=...` auto-detects the 2-row name/unit header correctly instead.
  - A successful `impASC` call **renames the destination book AND sheet** to
    the source filename — `wks.name$` must be (re-)set *after* import, and
    the post-import short name must be captured for any later cross-window
    plot reference.
  - Double-Y export needs an explicit `[%(qzbk$)]<sheet>!` range while the
    *graph* (not the worksheet) is the active window — a bare `(x,y)` range
    won't resolve; a `layer -nr`-created layer has no pre-made axis-title
    object, so its right-Y title needs `label -yr`, not `yr.text$`.
  (`docs/origin_re/validation_log.md`, "2026-07-05 (overlay + per-layer
  round)".)
- **The counting-convention bug that looked like a wrong shape.** The
  `.opju` curve token's `0x01`-subtype "third encoding" search initially
  rejected a real, correctly-shaped token because decoding its value through
  the wrong ordinal map (FPC-decoded-only columns instead of *all allocated*
  columns including empty/undecoded ones) gave wrong or out-of-range
  results — the byte shape was right all along; only the counting rule
  reading it was wrong. Before concluding a candidate shape is "a dead end,"
  re-check every plausible counting convention against it, not just the
  first one tried. (`docs/origin_project_format.md` §6.2.1, "The third
  encoding — FOUND".)
- **A style-boilerplate coincidence that "worked" by luck.** The `__BCO2`
  per-book boilerplate record's tail bytes happened to always resolve to
  local column index 3 ("C"), and every `XAS` book happened to plot column C
  as its real curve — making a false-positive match look correct until a
  *different* file (`UnpolPlots`, whose real bindings are B and G/H/I)
  exposed it. A decoder validated against too narrow/too-convenient a corpus
  can look 100% correct while silently relying on a corpus coincidence;
  cross-file validation against an oracle it wasn't tuned on is what caught
  this. (`docs/origin_project_format.md` §6.2.1, "False positive found and
  fixed".)
- **"Samples are not standards."** The standing project directive (see
  `Coding claude-config` memory `quantized-samples-not-standards`): don't
  overfit any decoder to the local `../test-data/origin` corpus; write
  general, structurally-validated grammar and document — never guess — the
  shapes the samples don't cover.

Source: `docs/origin_re/validation_log.md` (multiple dated entries, cited
inline above); `docs/origin_project_format.md` §6.2, §6.2.1;
`opju_figure_curves.py`/`figures_opju.py` module docstrings.

---

## 12. Index

### 12.1 Detailed docs

| File | What it covers |
|---|---|
| `docs/origin_project_format.md` | The primary, exhaustive byte-level reference this document indexes — container family, worksheet data (both codecs), windows-section metadata, sheet hierarchy, figures (axis/curves/text), notes/results-log, export, testing/corpus, clean-room provenance, open items |
| `docs/origin_re/opj_figures.md` | Superseded pointer → `origin_project_format.md` §6.1 (original `.opj` figures RE narrative preserved in git history) |
| `docs/origin_re/opj_windows_section.md` | Superseded pointer → `origin_project_format.md` §4.1 (original `.opj` windows-section RE narrative preserved in git history) |
| `docs/origin_re/opju_container.md` | Superseded pointer → `origin_project_format.md` §3.3/§4.2/§6.2 (original `.opju` container RE narrative, including the full XOR-delta/PREV-PRED historical trail, preserved in git history) |
| `docs/origin_re/validation_log.md` | Live, dated log of real-Origin COM validation runs (writer-load probes, ground-truth export sessions, live `.ogs`/COM-export verification) — the primary source for §11's RE pitfalls |
| `docs/opening_origin_files.md` | User-facing "what do I get when I import an Origin file" page — **see the contradiction flagged in §6.1**: its "Known limitations" section currently understates the curve-binding decode state relative to `origin_project_format.md` §6.1.1/§6.2.1/§6.2.2 |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | The tiered plan tracking every numbered RE item referenced throughout this document (item 11, 33, 34, 35, 36, …) |
| `plans/ORIGIN_GAP_PLAN.md` | The broader OriginPro-feature-parity gap plan (of which the file-format decode work is one part) |

### 12.2 Oracle / trial scripts (`tools/origin_trial/`)

| Script | Produces |
|---|---|
| `export_ground_truth.py` | `index.json` (books→sheets→columns, graphs→layers→axes) + per-sheet CSVs, for every corpus/specimen file |
| `export_hc2_oracle.py` | Just the `"graphs"` section of `index.json` for the two large Hc2 files (`export_ground_truth.py` is too slow/big for them) |
| `export_plot_refs.py` | `plots.json` — the file-wide per-plot `(book, column)` reference oracle (the strongest curve-binding ground truth) |
| `export_annotation_oracle.py` | `annotations.json` — per-text-object position/attach-mode oracle (§6.4) |
| `score_curve_bindings.py` | Standalone `.opju` precision/recall scorer, both file-level (`plots.json`) and per-graph (`index.json`) |
| `score_curve_bindings_opj.py` | Standalone `.opj` precision/recall scorer against `index.json` |
| `probe_opj_loader.py` | The native `.opj`-writer real-Origin-load probe kit (item 34) |
| `generate_specimens.py`, `generate_specimens2.py`, `generate_specimens3.py` | Controlled, known-content Origin specimen generators (the "Rosetta stone" files each RE breakthrough was pinned against) |

### 12.3 Key tests (`tests/`)

| Test file | Covers |
|---|---|
| `test_io_origin_project.py` | `.opj`/`.opju` worksheet-data decode — synthetic CI fixture + realdata regression anchors |
| `test_io_origin_ground_truth.py` | Reader output vs. Origin's own `index.json`/CSV oracle exports, order-free column matching |
| `test_io_origin_figures_opj_curves.py` | `.opj` curve→column binding, synthetic + realdata precision/recall floor |
| `test_io_origin_figures_opju.py` | `.opju` figure extraction (both axis-record forms) + curve-binding oracle tests (file-level and Hc2 per-graph) |
| `test_io_origin_tree.py` | Project Explorer folder-tree decode — synthetic structural-generality fixtures + realdata COM-verified pin |
| `test_io_origin_fuzz.py` | Hardening contract: any input → valid `DataStruct` or `OriginProjectError`, never a stray exception/hang/silent garbage |
| `test_io_origin_writer.py` | Native `.opj` writer round-trip (through quantized's own reader only — real-Origin load is the separate manual trial-window check) |
| `test_io_origin.py` | Origin-ASCII + `.ogs` export golden parity vs. the ported MATLAB `exportOriginScript.m` |
| `test_origin_com.py` | Mock-only COM "Send to Origin" tests (this suite never dispatches real Origin COM) |
| `test_realdata_corpus.py` | General cross-format realdata smoke test (one representative file per vendor/technique through `import_auto`) — not Origin-specific but includes Origin files in its corpus sweep |

All `realdata`-marked tests auto-skip when `../test-data/origin/` is absent,
so this whole verification layer is invisible-but-safe in CI and on other
machines.
