# `.opju` projects that hold no worksheet data, and empty graph layers

2026-11-20 corpus sweep, lane U. Baseline: `main` 9fe23400, public corpus
(351 third-party `.opj`/`.opju`). Code: `io/origin_project/opju_no_data.py`,
`container.bad_header`.

## 1. Files that are not Origin projects

Five corpus "projects" failed with "bad header ... open in Origin Viewer":

| shape | count | now reported as |
|---|---:|---|
| Git LFS pointer stub (`version https://git-lfs.github.com/spec/v1`, ~130 bytes) | 4 | "is a Git LFS pointer, not the Origin project itself (the real file is N bytes). Fetch the real file with `git lfs pull`" |
| plain-text placeholder | 1 | "is a plain-text file, not an Origin project" |

Also handled: an empty file, and the other Origin container under the wrong
extension (CPYUA bytes in a `.opj`, CPYA bytes in a `.opju`: "rename it").
Only an unrecognised binary keeps the generic message and the Origin Viewer
advice. Synthetic tests: `tests/test_io_origin_not_a_project.py`.

## 2. Real projects whose worksheets decode nothing

Four real CPYUA projects failed with "no worksheet columns could be
decoded". None is a decoder gap: the data is not in the file.

### 2a. Data Connector books saved without their data (2 projects)

`61 PDOS.opju` ("found 1 empty workbook") and `Analysed and Plotted
Graph.opju` ("found 6 empty workbook(s)", one book of six sheets).

Evidence:

- Every dataset record of the book is intact and length-checked, and
  declares **1 allocated row, 0 used rows** (header `0x19` = 1, `0x21` = 0)
  for every column (10 and 36 columns).
- The book's own page span names an Origin Data Connector
  (`CSV_Connector\0` / `Excel_Connector\0`, an `OriginStorage` `<File1 ...
  DataID=...>` block) and the source file's full path
  (`...\61 PDOS.csv`, `...\GRB_data_for_Origin.xlsx`).
- Oracle: Origin's own saved page previews of the graphs plotted from those
  books show plotted data (PDOS curves; a BIC model-selection plot). The
  data existed when the graphs were drawn; the file does not carry it.
- Whole-corpus distribution (285 CPYUA files): 87 connector books in 41
  projects. **83 carry their data** (allocated = used > 0 — negative
  controls, including five sibling `PDOS` projects of the same author with
  the same CSV connector), **4 are exactly 1-allocated / 0-used**: the two
  projects above and `稳定性.opju` Book1/Book3 (a project that also has
  other books). Books of this shape WITHOUT a connector (Origin's untouched
  default `Book1`) are not a loss and stay "empty workbook omitted" in a
  project with other data, as before.

Reading: Origin's connector option to leave imported data out of the saved
project (data re-imported from the source on open).

`稳定性.opju` (lane S, 2026-11-21): its Book1 / Book3 are such books in a
project that imports others, so they produce no DataStruct at all. Their
curves (Graph9-12: Book3 B/D plus error plots) used to stay in the figure
for the frontend to drop silently, and the pages opened no book.
`import_manifest` now passes the worksheet fidelity's `unsaved_books` to
`omit_unsaved_curves`: those curves are omitted as `data_not_saved` like a
placeholder book's (an imported sheet of the same base name is kept).
Origin's previews show the data; we cannot (it is not in the file). **Owner-COM check**:
open `61 PDOS.opju` in Origin with the CSV missing and confirm the book is
empty / the connector reports the missing source.

### 2b. Graph-only projects (2 projects)

`30流线.opju` and `50流线.opju` (1.0 / 1.2 MB, build 4.3268): **no dataset
header at all** (no 147-byte expansion with a dataset name anywhere; the only
two 147-byte RLE expansions have no name), no matrix, no Book page — one
graph page. The page's bulk is an LZ4-coded raster: its literals are
`R G B FF` pixel quads with LZ4 back-references. Origin's saved preview of the
page shows a picture (a streamline field image), not plotted data. This is
a graph whose content is a pasted image; there is nothing to import except
the page and its preview.

### What the import does now

Instead of failing the whole project (`opju._parse`):

- When nothing decodes **and** the project has a graph page
  (`unrecovered_graph_pages(b, set()).missing > 0`), the empty books (or,
  with none, one book named after the file) import as empty placeholder
  books with `metadata["origin_worksheet_unavailable"] = {reason, detail
  [, connector, source]}`. The Inspector's Origin provenance card shows the
  detail. A project with no data **and** no graph still raises.
  So does one whose scan found any record it could not read (an undecoded
  form, a damaged header, a checksum or budget failure, an unshaped matrix,
  a report column: `opju_no_data.nothing_left_unread`) — the data may be in
  the file, so the import fails closed with its census.
- Connector books saved without data are listed in the worksheet fidelity
  report (`unsaved_books`) and summarised as the loss `data_not_saved` —
  also for `稳定性.opju`, whose other books import normally.
- Curves plotted from a placeholder book are moved to `curve_sheet_omitted`
  with reason `data_not_saved` (`omit_unsaved_curves`), before the sheet
  check, so the graph is listed with every curve accounted for and its
  saved Origin preview, never drawn from an empty book.

Realdata tests (`tests/test_io_origin_opju_no_data.py`) recompute every
expectation from the corpus at run time: each connector book is reported
unsaved iff its own records are 1-allocated/0-used; every dataset-free
project imports iff it has a graph page, and then carries its saved preview.

## 3. Actionable graph layers with no curves (baseline: 160 in 26 projects)

Classification of every layer (`empty_actionable_graphs`):

| class | layers | what it is |
|---|---:|---|
| map layers (heatmap / matrix) | 5 | **Not empty**: drawn from `figure.map`, not `curves` (`fig05_heatmap_flights` 1, `Fig3_c_模式连接矩阵` 4). The sweep metric counts `curves` only. |
| every curve omitted, fail-closed, with a per-curve reason | 155 | Curves exist and are decoded; each is in `curve_sheet_omitted`. |
| genuinely empty (text / legend only, blank inset) | 0 | Such layers have no curves and no source hint and are already filtered as internal records (`fidelity._filter_reason`), never actionable. |

The 155 by omission reason (curves; a layer may mix reasons):

| reason | curves | class |
|---|---:|---|
| `stat_layer_in_multi_layer_page` | 153 | plot type not rebuilt (SOP_meas only) |
| `column_not_imported` | 79 | sheet binding (Book@N re-bind) — see below |
| `x_not_a_column` | 76 | X is row numbers / bins (stat plots) — plot type |
| `histogram_of_several_columns` | 47 | plot type not rebuilt |
| `x_sheet_unproven` | 24 | binding unproven |
| `error_bar_plot` | 23 | plot type not rebuilt |
| `plot_row_range` | 21 | partial row range not rebuilt |
| `box_kind_not_decoded` | 20 | plot type not decoded |
| `x_token_differs` | 10 | binding unproven (X form not decoded) |
| `hidden_in_origin` | 9 | correct: Origin does not draw them |
| `worksheet_filter` | 5 | filtered rows not rebuilt |
| `y_is_x_column` | 3 | binding unproven |
| `stat_plot_x_not_decoded`, `book_not_imported`, `sheet_unknown` | 2 each | plot type / binding |

No binding failure here is provable within this lane: the
`column_not_imported` group (Figure4, 生化指标非线性, soil deep, RSOS_*_micstruc,
TEA_ExcelGraphs) is the `Book@N` sheet re-bind of `opju_curve_sheets` — the
curve-sheet-binding lane's area — and each was left alone. The empty-layer
presentation was already "kept with a note": the Library row counts the
left-out curves and the Recover window lists one line per curve. Eleven
reason codes had no wording there (the raw code was shown); they now read as
sentences (`frontend/src/lib/originCurveOmissions.ts`), plus
`data_not_saved`.

Booked for the owner / other lanes: the sweep's `empty_actionable_graphs`
should count a layer with `map` (or `ternary`) as non-empty.
