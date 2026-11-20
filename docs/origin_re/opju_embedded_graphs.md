# `.opju` graph pages Origin lists but the import did not decode

Solved 2026-11-20 (lane C, on top of `opju_layer_record`). Code:
`src/quantized/io/origin_project/opju_embedded_graphs.py` (embedded workbook
graphs), `opju_layer_pages.py` (which page an anchor belongs to, its name and
layer), `opju_layer_record.py` (`04 01` Y scale), `import_manifest.py` (the
census). Tests: `tests/test_io_origin_opju_embedded_graphs.py` (synthetic),
`tests/test_io_origin_opju_embedded_graphs_corpus.py` (`realdata`, COM
oracle), plus the existing oracle rescore in
`tests/test_io_origin_opju_page_attribution.py`.

## The 782 pages

Oracle: `ground_truth_public/axis_ranges.json` (Origin 2026b COM, `doc -e P`;
113 public projects, 2,296 graph pages, 3,878 layers). On the base branch
(PR #775) 782 of its pages had no decoded layer, while the import reported
only 11 unrecovered graph pages. Classified page by page:

| why the page had no decoded layer | pages | example projects |
|---|---:|---|
| not in the page census: a graph **embedded in a workbook** whose name is NOT in the file (sparklines Origin redraws from the column data on load: no name bytes, no layer record) | 528 | `cleaned_data` 144, `Figure 3 and 4 amplitude - rise time data` 130, `SOP_meas` 80, `Figure 6 Currents vary parameters` 41 |
| not in the page census: an embedded workbook graph whose header IS stored (`FitLine*` fit-report graphs 102, `Residual*` 81, stored sparklines 39) | 222 | rise-time file 118 (`FitLine*`/`Residual*`), `生长指标非线性拟合` 20, `稳定性` 14, `SOP_meas` 16 |
| in the census as an embedded report graph (`0a`-framed, dropped from spans by `opju_embedded_pages`): `Residual*` | 21 | rise-time file only |
| id-table-less stream: the layers decode, but unnamed | 9 | `BD_SC_all`, `BD_TC_all`, `RSOS_SC_all` (3 each) |
| anchor rejected by the layer-record checks: Y scale field `04 01` | 2 | `figures.opju` (falcon-sqh) `fig_converge_3/4` |
| page in the census with no layer anchor | 0 | |
| hidden / minimized | 0 | no page needs it: every class above is explained without it |

So the census was not undercounting user graph pages: 771 of the 782 are
graphs embedded in workbooks, which the page enumeration deliberately does
not treat as pages. What was missing was a report of them.

## Embedded workbook graphs

Inside a workbook span, an embedded graph keeps the page header's name
field `<namelen+2> 00 00 <name> <trail >= 80>`, and the byte after the trail
is `0c` (as after an ordinary graph header: `Graph1 90 0c`). The bytes in
front of the length byte vary (`40 80 7f`, `80 89 01`, `0a 80 01`, or a
sparse-coded run), so they are not used. Gates: name of 2+ characters, `0c`
(or `c1`) after the trail, name not one of the project's pages.

* Oracle projects: the gate finds 243 headers, every one an oracle page;
  they are every `FitLine` and `Residual` page plus 39 sparklines.
* Negative control: the matches in workbook spans that fail a gate are all
  1-character names (`z`, `S`, `G`, ...; 10 in the oracle projects), none an
  oracle page. Every 2+-character match in either corpus has `0c` or `c1`
  after its trail.
* Both corpora (351 public + 104 owner files): 655 headers — FitLine 229,
  Residual 224, sparkline 196, and 6 `Graph<N>` cell graphs (Etna
  `origin.opju`). After the trail: `0c` 648, `c1` 7.
* Every record-length-prefixed layer anchor on a workbook page follows one of
  these headers (427 of 427; none precedes the first header). Each
  FitLine / stored sparkline header has exactly one anchor, as the oracle
  lists one layer; `Residual` pages (4 oracle layers) have none.

`figures_opju` now names a workbook-page anchor after the header before it
(ordinal from 1 after each header), so those layers are scored by name: all
12 the oracle lists agree. The readers are unchanged: a workbook-page record
is still read only by the specimen / real-form readers, never at the fixed
offsets (their curves would bind a column as X where a sparkline plots row
number). These figures have no curves and stay filtered, as before.

The manifest lists the embedded graphs not decoded apart from the graph
pages: `embedded_graph_count` + `embedded_graphs` (`page_name`,
`host_book`; first 50). No omission code: their data are the report's or
the sheet's own columns.

## Id-table-less streams

With no column-id table (`BD_*`, `RSOS_*`, two `shawxgf` files), a page whose
span holds `_cart_object` is now a graph page (named, layer-numbered, and
coincidental bare anchors removed as on other graph pages) — the same rule
`opju_graph_pages` already counts graph pages by. All 9 oracle layers agree
once named. `F72_Femtosecond...`'s `F72AC` (no `_cart_object`) stays `""`.

## `04 01` = log10 Y

Field at expanded offset 98, over every prefixed graph-page record of both
corpora: `01 00` / `00 00` / `04 00` / `02 00` or `08 01` / `04 01`. COM
`layer.y.type`: linear for all 2,772 listed `xx 00` records, log10 for all 16
`08 01` and all 9 `04 01` records. Byte 99 is the log flag. `04 01` occurs only
in falcon-sqh `figures.opju` (9 records, all in the oracle, ranges match,
Y step 1); admitted as that value only.

## The census rule

A page now counts as recovered when one of its layers is IMPORTED (survives
the fidelity filter), not merely decoded. A page whose decoded layers were all
filtered (no curves and no matching source) used to vanish: neither a figure
nor an unrecovered page. It is now reported, with Origin's saved preview.
This is what keeps the no-data projects (`30流线`, `50流线`, `RSOS_SC_all`)
showing Origin's own picture once their layers are named. Corpus: 61 such
pages in 25 public projects (e.g. `SOP_meas` 13, `Fig3_b_模式示意图` 6,
`Supplemetary_Fig_10` 5) and `Hc2 data` Graph5 (the documented tokenless
duplicate-window page) in the owner corpus.

## Result (COM oracle, 113 projects)

| | #775 | now |
|---|---:|---:|
| oracle pages with a decoded layer | 1,514 | 1,537 |
| oracle layers decoded, X/Y from/to agree | 2,783 | 2,813 |
| disagreements / phantom layers | 0 / 0 | 0 / 0 |
| axis scales agree (x and y) | 5,566 | 5,626 |
| pages with no decoded layer | 782 | 759 |
| ... reported as unrecovered graph pages | 11 | 0 |
| ... reported as embedded workbook graphs | 0 | 231 |
| ... not stored in the file (sparklines) | — | 528 |

231 + 528 = 759: every oracle page is decoded or accounted for
(`test_every_oracle_page_is_decoded_or_accounted_for`).

## Still open (owner COM checks)

* Sparklines not stored in the file (528 oracle pages): Origin regenerates
  them on load. Counting them would need the rule that decides which columns
  get one (sparkline label row shown?) — not proven, so not counted. COM:
  per workbook, which columns' sparklines exist after load, vs the book's
  label-row settings.
* `Residual*` report graphs (102): header stored, no layer record after it.
  Where Origin keeps their 4 layers is not known.
* The `80 e9` (and other) values at offset 98 that the layer-record checks
  reject: all 85+ are on workbook pages, i.e. embedded graphs, which the
  fixed-offset reader does not read; no graph page is lost to them.
* X scale field `02 00` (12 records, both copies of `Hc2 data`) and Y
  `02 00` (one record, `Sample_OriginPro_ResonatorData`): byte 56/99 = 0
  suggests linear, but no oracle lists them.
