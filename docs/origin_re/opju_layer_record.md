# `.opju` graph-layer record = the sparse-encoded `.opj` layer block

Solved 2026-11-20. Code: `src/quantized/io/origin_project/opju_layer_record.py`
(wired into `figures_opju.extract_figures_opju` ahead of the real-form reader).
Tests: `tests/test_io_origin_opju_layer_record.py` (synthetic grammar and
fail-closed cases), `tests/test_io_origin_opju_layer_record_corpus.py`
(`realdata`: positive and negative controls computed at test time).

## Why graph pages went missing

Baseline (`main` 9fe23400, 351-file public corpus): 211 graph pages in 82
projects were reported `graphs_not_recovered`. Classified page by page
(213 `.opju` pages; 1 `.opj` window):

| why unrecovered | pages | recovered now |
|---|---:|---:|
| every layer anchor present (`03 00 00 1f/5f`, record-length prefixed), but no axis-record reader (specimen / real / hybrid) decoded it | 202 | 200 |
| id-table-less stream (no column-id table): layers decode, but **unnamed**, so the page still reads as missing | 11 | 0 |
| `.opj` window whose first block head is `0x47` (`3dband-origin.opj` Graph2, `opj_graph_windows`) | 1 | 0 |

No page was missing because of its plot type: by template name the 213 are
scatter/line/symbol 129, multi-panel/merged 20, user templates 20,
stacked-area/offset 19, bar/column/pareto 15, box/violin 8, heatmap 2 --
and all of them failed in the same place, the axis record. None is a layout
page and none binds only to matrices.

`no_graph_records` (65 projects, 31 `.opj` + 34 `.opju`): none holds an
unreported graph page. They are the Altaxo / liborigin / labplot
reader-test projects and worksheet-only files: no `_cart_object`, no
record-length-prefixed layer anchor (the few `03 00 00 1f` matches are
`ogColGroup` records), and their PNGs are workbook thumbnails. Two
exceptions hold layer content without a graph page: `electric_field_proj_median.opju`
has 10 embedded (workbook-page) layer records whose Y block does not sit at
the fixed offsets (left undecoded, see below), and liborigin's `crash.opj`
(a malformed reader-test file) has stray `.opj` layer heads.

## The record

The layer anchor `03 00 00 1f` is the record's first sparse chunk (`03` =
three literals `00 00 1f`). Expanded with CPYUA's grammar --
`0x01..0x7f` n literals, `0x80..0xbf` (t-0x80+3) zeros, `0xc0..0xff <b>`
(t-0xc0+3) repeats -- it is the `.opj` layer-continuation payload, fields at
the `.opj` offsets: X from/to/step f64 at 15/23/31, X scale u16 at 55, Y
from/to/step at 58/66/74, Y scale u16 at 98 (`01 00` linear, `08 01` log10,
the `.opj` `_y_scale_flag` values).

The real-form reader's token types (tagged compact `8T nn`, `c2`/`c3` RLE
with a "context byte") are this grammar seen one double at a time. Note
`opju_column_fixed.expand_record` reads every zero run as followed by a
literal count; that is wrong where a repeat follows a zero run (`87 c3 66
...`), which column records apparently never contain but layer records
often do. Not changed here (column decode untouched); worth aligning.

## Evidence

* Positive control: 2,937 records the existing readers decode; all pass this
  reader's authentication; 2,934 agree on X/Y from/to (and steps).
* The 3 range disagreements and 8 scale disagreements were checked against
  Origin's saved previews; the fixed offsets were right every time
  (`ExtFig4` Graph2 X 0..32.5, `heatbudget` Graph1 X ..2459823.5 (Sep 2022),
  `optimal_MOI…fig5` Graph2/Graph5 X log, `SOP_meas` Graph4/Graph70 layers
  3/5/11 Y log). These records now decode the fixed-offset way.
* Negative control: 0 of 222 unprefixed (coincidental) anchors accepted.
* COM oracle (`ground_truth_public/axis_ranges.json`, Origin 2026b, 113
  projects): every one of the 252 newly decoded named layers it lists (119
  pages, 33 projects) and the 9 layers whose decode changed match Origin's
  X/Y from/to (rel 1e-6), and every decoded scale matches `layer.x/y.type`
  (5,534 linear, 32 log10 over all scored layers); no phantom layer.
* Owner corpus: `Hc2 data` Graph34 (plan item 75) now decodes, X 0..9 step 2,
  Y 0..7e-8 step 2e-8 with three curves, matching its saved preview
  (nm-labelled ticks 0..60 step 20). `PNR.otpu` (styles-only before) now
  decodes in full.
* **Graph pages only.** On a workbook page the same records decode (one
  embedded graph per book in the owner corpus), but their X spans the ROW
  count while the curve reader binds the book's X column, so they would draw
  a column against the wrong X. `figures_opju` reads fixed offsets only on
  graph pages (and id-table-less streams); book-page records stay with the
  older readers, as before (66 layers in the public corpus).
* 423 records no other reader decodes; ranges and tick steps compared with the
  saved previews of 12 projects (merged/stacked panels, violin, histogram +
  cumulative layer, Julian-date axes, reversed log 1..1e-13, 1e9 values).

## Corpus delta (sweep2, 351 files, vs `main` 9fe23400)

| | before | after |
|---|---:|---:|
| unrecovered graph pages | 211 | 12 |
| projects with `graphs_not_recovered` | 82 | 5 |
| graph records (layers) | 2,991 | 3,347 |
| actionable figures | 2,841 | 3,187 |
| figures with curves | 2,681 | 2,954 |
| curves | 6,645 | 7,807 |
| status `unresolved` | 114 | 83 |

Books unchanged (3,174). No project loses a figure. Four layers
lose a curve each: `SOP_meas` Graph37/38/42/45 layer 1 is a histogram whose
page also holds a cumulative-percent line layer (visible in the preview);
with layer 2 now decoded the page is multi-layer, and the existing stat rule
(`opju_stat_plots`, `stat_layer_in_multi_layer_page`) omits and diagnoses the
histogram instead of drawing it as if it were the whole page.

## Still open (owner COM checks)

* ~~Y scale field `04 01`~~ solved 2026-11-20: log10 (byte 99 is the log
  flag; COM `layer.y.type` log10 for all 9 records), see
  `opju_embedded_graphs.md`.
* Records whose offset 98 reads `80 e9` and others: re-surveyed 2026-11-20
  over both corpora, they are ALL on workbook pages (embedded fit-report /
  sparkline graphs: `80 e9` 85, unexpandable 83, `00 80` 28, ...), where the
  fixed offsets are not read anyway. On graph pages every prefixed record
  now reads except 13 (`02 00` X field: 12 in the two `Hc2 data` copies; one
  `02 00` Y field), see `opju_embedded_graphs.md`.
* ~~Id-table-less streams~~ solved 2026-11-20: a `_cart_object` page is a
  graph page there (`opju_layer_pages`); all 9 oracle layers agree once named.
