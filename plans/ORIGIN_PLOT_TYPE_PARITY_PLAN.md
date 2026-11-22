# Origin Plot-Type Parity Plan

Every 2D plot type a researcher makes in Origin must (1) be buildable from
scratch in quantized and (2) import from an Origin-made `.opju` to the same
figure. The evidence comes from a generated corpus. A seeded data generator
plants known data, and the locally installed Origin 2026b Student builds each
plot type from it over COM. Origin's own answers are saved as the oracle: the
plotted datasets, the plot type, axis ranges, styles and a PNG. quantized is
then scored against those answers on both paths. Passing examples join the
private `test-data` corpus.

**Parent:** MAIN_PLAN.md
**Status:** Active
**Created:** 2026-11-15
**Updated:** 2026-11-16

---

## Context

### How the pieces fit together

- **Creation side.** Gallery `frontend/src/lib/plotTypes.ts` (line, scatter,
  line+symbol, area, column, stacked column, box, violin, histogram,
  contour/heatmap, double-Y, polar, waterfall, stacked panels, ternary). Stat
  modes are in `lib/plotviewSanitize.ts`, which also has strip. Marks are in
  `lib/plotspec.ts`, which also has step. Multi-panel is in
  `lib/composition.ts`, insets in `components/Stage/InsetPlot.tsx`, and
  quiver/streamline in `workshops/fieldplot`.
- **Import side.** `.opj` plot type byte 76 is in
  `io/origin_project/opj_curves.py`; `_PLOT_TYPES` covers 203 column, 215 bar
  and 219 histogram. `.opju` reads the `8f 01 <type> 83` style tag;
  `opju_sheet_signals.py` draws only types 200-203. The frontend routes
  histograms in `lib/originFigureSelection.ts`.
- **Gaps known at creation:**
  - column and bar are decoded but never reach the bar renderer;
  - `.opju` sets no `plotType`;
  - box, violin, polar, contour, ternary and waterfall Origin graphs have no
    mapping;
  - there is no horizontal bar;
  - step and strip have no gallery tile.
- **Oracle.** `Origin.Application` over COM only, never `ApplicationSI`; see
  CLAUDE.md "Origin COM oracle runs". Student saves `.opju` but not `.opj`
  (measured 2026-11-15: `Save("x.opj")` writes `.opju`), so Origin-made
  specimens are `.opju` only. Export with
  `expGraph type:=png path:=... filename:=...` works.

### Data / control flow

```
tools/plot_corpus/generate.py   seeded data families + .truth.json
        │
        ▼
tools/plot_corpus/origin_build.py  (COM) book per family → graph per plot type
        │                            → save .opju + oracle.json (%Z datasets,
        │                              plot type, axis from/to/type, styles) + PNG
        ├──────────────► check 1: quantized import → score vs oracle.json
        └──────────────► check 2: quantized recipe (same data, same type)
                                  → score vs oracle.json + PNG side by side
passing specimens → test-data/origin/generated/<type>/<family>/
```

### Plot-type codes (Origin 2026b, measured 2026-11-15)

`plotxy plot:=N` reports success for ANY N (even 999), and no LabTalk or COM
property reports a plot's type. The readback is Origin C
`DataPlot::GetPlotType()` (`tools/plot_corpus/qz_oracle.c`), checked against
the exported PNGs. "Menu recipe" is Origin's own Plot-menu command from its
installed `Plot.ogs`, with ids from `PlotPopup/FilterPlotTypes.xml`.

| Read-back type | Plot type | Menu recipe (`worksheet -p`) | Notes |
|---|---|---|---|
| 200 | line | `200 Line` | also polar (`192 Polar`), 2D stacked/offset lines (`200 OffsetStackY`) and steps |
| 201 | scatter | `201 Scatter` | also bubble (`193 bubble`), colour-mapped (`247 colormapped`) and ternary (`245 Ternary`) |
| 202 | line+symbol | `202 LineSymb` | double-Y (`? DOUBLEY`) is two layers of 202 |
| 203 | column | `203 Column` | |
| 204 | area | `204 Area` | |
| 205 | high-low-close | `205 HLClose` | |
| 206 | box | `206 Box` | violin (`206 Violin`) and strip (`206 ColumnScatter`) read back the SAME 206; the template is what differs |
| 207 | floating column | `207 FloatCol` | needs >= 2 Y columns |
| 208 | vector XYAM | `208 vector` | |
| 213 | stacked column | `213 StackColumn` | |
| 214 | stacked area | `214 StackArea` | |
| 215 | bar (horizontal) | `215 Bar` | |
| 216 | stacked bar | `216 StackBar` | |
| 219 | histogram | `219 Hist` | |
| 220 | image (matrix) | `220 image` | |
| 226 | contour (matrix) | `226 Contour` | |
| 243 | contour (XYZ) | `243 TriContour` | |
| 105 | heatmap (matrix) | `105 HeatMap` | `105 HeatMap` on an XYZ sheet made no graph |
| 231 / 233 | Y- / X-error bars | added for Y-error / X-error columns | `plotxy plot:=231` on a sheet with no error column KILLED Origin |
| 232 | data labels | `plotxy` scan | |
| 241, 249 | fill area between curves | `plotxy` scan | |

- **Line connect is not a plot type.** Steps set `layer.plotN.line.connect`:
  1 none, 2 straight, 3/4 2-/3-point segment, 7 step horizontal, 8 step
  vertical, 9/10 centred steps. `set %C -l` numbers these differently.
- **Polar and ternary are layer coordinate systems.** Their plots read back
  as 200/201, so an importer must read the layer, not the plot byte.
- **The type is one byte.** Codes 256 and above read back mod 256. The
  exceptions are template-level ids that map onto base types:
  - 263 → 206 (split violin);
  - 264 / 271 → 104;
  - 265-268 → 225 (pie family);
  - 269 → 203 (radial bar);
  - 270 → 213;
  - 343 → 120;
  - 344 / 345 → 123;
  - 349 → 200 (colour-mapped line).
- **Codes 234-239, 244 and 250-255** are accepted with XY input and draw
  nothing (234, 235, 244, 250-255) or 3D-style lines (236-239). Their input
  shape is still unknown.
- **Out of scope (3D).** Origin 2026b's `Waterfal` template is the 3D
  waterfall, and `247 CMAP` draws 3D walls (it read back 204).
- Earlier visual codes kept from the first probe: 120/123 bubble map, 122
  doughnut/sunburst, 225 3D pie, 114 compass, 218 vector XYXY (made no
  graph from a 4-column XY selection), 108 polar tree, 210/212 3D.

### Dependency map

- Items 2 and 3 use the shipped item 1 harness and are independent of each
  other.
- Item 4 (done) merged 2 and 3; re-run it with `tools/plot_corpus/scorecard.py`
  after any fix to see which gaps closed.
- Items 5-8 are per plot-type family and parallelizable. Each one runs its
  import fixes (this session, COM) and books its creation gaps (cloud).
- Item 9 (round trip quantized → Origin) shipped 2026-11-16; its exporter
  gaps are items 20-26 (re-run `tools/plot_corpus/roundtrip_*.py` +
  `score_roundtrip.py` to verify each). #20/#21/#23 are bugs (the export
  writes something wrong), #22/#24-#26 feature gaps.
- Items 10-19 are creation gaps for the cloud sessions, independent of each
  other; #10 and #14 share the missing bar-creation UI. Re-run
  `tools/plot_corpus/scratch_run.py` to verify each.

### Resolved decisions (owner, 2026-11-15)

- **Scope.** All 2D plot types in the first batch. 3D is out of scope.
- **Missing creation types.** A type that cannot be built from scratch in
  quantized (e.g. horizontal bar) is booked as a plan item for the cloud
  sessions. This local session does generation, COM checks and import
  fixes.
- **Comparison.** Automated field checks (data, plot type, axes, styles),
  plus Origin's PNG beside quantized's render for owner review. No pixel
  diff.
- **Round trip.** quantized → Origin export checked by Origin comes in a
  later batch.
- **Defaults.** Synthetic data only, licence-clean; large cases are kept
  small enough to keep `test-data` cheap to clone.

### Owner gates

- None open.

---

## Tier 1 — High Impact

None open.

## Tier 2 — Medium Impact

5. **XY family import parity** — line, scatter, line+symbol, step, area,
   stacked area, double-Y, error bars/bands, log/reversed axes, multi-layer.
   Measured by the item 2 scorer (2026-11-15, 231 specimens; anchor
   specimen named per gap). Items 6 and 7 share the first two gaps.
   - [x] ~~**No curve binding decodes on any Origin 2026b `.opju`: 0 / 484
         Origin curves.**~~ FIXED 2026-11-15
         (`fix/opju-2026b-saved-bindings`). Cause: the column-id table's
         field walk required the `09` "separator" and the `21 51/21 61/30 61`
         markers, which are really the column's display format (offset 30 =
         9, Text & Numeric) and two format flag bits -- every COM/LabTalk-
         filled column is Numeric (`01 50/01 60/10 60`, no `09`). Proven by a
         COM matched pair (same book saved as format 1 vs 9: only offsets
         30, 37 bit 0x20 and 38 bit 0x01 differ). New `opju_column_fixed`
         reads the record at fixed offsets (code 17, name 18, format 30,
         partner 35, flags 37/38; 36,240 corpus records where both readers
         decode agree 100% on name + designation) and only ADDS ids the
         walk did not resolve; `opju_curve_token_x` masks the same two
         format bits. Scorer: curves 0 -> 229 match / 0 wrong; styles 0 ->
         412 match / 0 wrong; plot type 13 -> 46 match; axes 804 -> 870
         match. Histograms bind but omit (`x_not_a_column`, record X id 0:
         Origin plots them against row numbers, item 71 of the decode plan).
         Real corpus vs main (359 `.opju`, Origin 2026b COM `%Z` / `xof` /
         `wks.col.type` / `lname$` on every changed file): 0 curves
         vanished; every newly drawn curve matches Origin except 4 that are
         error-bar plots (sub-task below); 3 main curves drawn against the
         wrong X now bind Origin's X; every changed designation matches
         `wks.col.type`; labels match or stay the short name (omitted), 11
         carry the importer's existing duplicate-name suffix (`E (2)`).
   - [x] ~~**No column metadata decodes: designations 0 / 806, long names
         0 / 806, units 0 / 105.**~~ FIXED 2026-11-15. New `opju_record_meta`
         labels sheets `windows_opju`'s raw marker scan leaves unlabelled,
         from the column records themselves (designation code at offset 17,
         label record after the record, sheet by the window's sheet headers
         + the id table's sheet map; a sheet is labelled only when every
         column is covered). Scorer: column metadata 0 -> 1,609 match /
         0 wrong (108 omitted); error bars 0 -> 12 match. Re-measured on main
         `4b544c8e` (2026-11-15, after #704/#706/#707/#709): 1,709 match /
         0 wrong / 8 omitted -- the 100 closed by the Numeric-format column
         records, designation codes and name-bound labels; the 8 left are
         `label_is_short_name` (text-category X x5, ternary x1, see item 6).
   - [x] ~~**Error-bar plots decode as curves**~~ FIXED 2026-11-15 (own
         commit). The curve token's plot byte 76 = 0xe7 / 0xe9 is Origin's
         plot 231 / 233 (y / x error bar); such a curve is omitted
         (`error_bar_plot`, `opju_plot_gates`) and its caption dropped with
         the rest renumbered. Scorer: curve/drawn phantoms 6 -> 0. Real
         corpus: 2,738 error-bar curves -> 0 (36 files; 2,734 of them on
         main). COM `GetPlotType()`: all 2,738 tokens with those bytes are
         error-bar plots, 0 of 1,731 other-byte tokens are; resolved legend
         captions of all 1,395 kept curves on those layers unchanged; 109
         Y-error bars still attach to Origin's Y from the decoded
         designations, 13 X-error bars do not draw (no horizontal whiskers)
         and 2,616 Y-error bars are lost because their column's designation
         does not decode (2,447), it is not Y-error (95) or pairs with
         another Y (60) / an undrawn Y (14) -- an omission, never a line.
   - [x] ~~**Error bars lost with the phantom lines**~~ FIXED 2026-11-20
         (`opju_error_bars`, `docs/origin_re/error_bars.md`): the plot
         record's X field (offset 35) names the decorated curve, offset 23
         its direction (1 plus, 2 minus, 3 both; bit 0x10 = X error, which
         is what makes 12 0xe7 tokens Origin's 233). A curve gets `yErr`
         from one both-ways plot or two equal halves; `.opj` uses the same
         record (its error plots were drawn as lines). Public: 1,803 ->
         882 figures with `error_bar_plots`, 1,845 plots on 1,207 curves
         attached; owner: 149 plots, 167 `.opj` phantom lines gone.
   - [x] **Asymmetric error bars on a figure**: 874 public halves (437
         curves, mostly PerceivedRisk) have proven plus/minus columns that
         differ; the figure path carries one symmetric `errKeys` column per
         curve. Needs the halves as the figure's error bindings (the
         renderer already draws asymmetric spans).
         DONE (#788, ledger F-067; `test_realdata_halves_attach_plus_and_minus_by_their_authors_names`); verified 2026-11-21 (Lane OD triage).
   - [x] **Two both-ways error plots on one curve** (420 public): which
         one Origin draws (or a band + bars) needs the COM check in
         `error_bars.md`.
         DONE (#788, ledger F-069: equal columns attach (420 of 420 equal, PREV Graph29AA), anything else stays left out); verified 2026-11-21 (Lane OD triage).
   - [x] **X-error bars from a figure's own plots** (13 public, 12 owner):
         bind them as the curve's X error (book roles draw some today).
         DONE (#788, ledger F-068; `test_realdata_lollipop_x_halves_draw_stems_to_zero`); verified 2026-11-21 (Lane OD triage).
   - [x] ~~**Step drawn as a line**~~ FIXED 2026-11-15: curve record byte 17
         = 11 is `line.connect` 7 (13 specimens, 39 curves; 0 of 7,103
         corpus records), so the line style is withheld
         (`opju_plot_gates`); the curve stays bound. Drawing true steps is
         the "no quantized mapping for step" sub-task below.
   - [x] ~~**Phantom sheet from a deleted sheet.**~~ FIXED 2026-11-15 with
         the stacked `CS` book (item 6, `opju_loose_books`): Origin renames a
         deleted sheet's datasets into a window-less book (`DelA_A@2`,
         COM `doc -e S`), which is no book in Origin's `WorksheetPages`; it
         is dropped (`loose_books_omitted`). The survivor's datasets are
         Origin's own `Del_A@3` / `Del_B@3`, so its key `Del@3` is Origin's
         sheet id, not a wrong name. Scorer: 5 phantom sheets -> 0.
   - [ ] **Sheet display names.** A `Book@N` pseudo-book is titled
         `"<Book> (sheet N)"` from its dataset id; Origin's sheet name
         (`Keep3`, COM `Layers.Item(j).Name`) is not decoded for `.opju`.
         The window section writes one `82 02 50 64` sheet header per live
         sheet (`opju_sheet_segments`), the name ~65 bytes after it, and
         segments map to ids. Needs a COM sheet-name / `%(i,@D)` dump of
         every multi-sheet book before any title changes.
   - [ ] **Loose datasets Origin plots** (real corpus, COM `%Z`):
         `Book1A_D` / `Book1B_D` (`迭代次数`), `Book2_C` (`30流场`),
         `Book2_C@3` (`50流场`) are drawn by graphs whose curves the figure
         decode does not bind, and are no longer Library books. When those
         curves decode they need their data without a Library book.
   - [ ] **Graph layer not recovered** (`graphs_not_recovered`, no axis
         record decoded). Combined scorecard 2026-11-15 (main `4b544c8e`):
         line / line+symbol / scatter / step x {duplicates, huge_tiny,
         log_range, multi_x}; area x {huge_tiny, log_range}; double_y,
         stacked_area, stacked_lines_offset x {log_range}. `masked_rows` is
         recovered everywhere now (struck from the lists above). Where a layer
         IS recovered the axes are exact: 870 / 870 from/to/log match, 0
         wrong. Scorecard: 114 of 233 specimens still carry an omitted
         curves cell, 93 an omitted axes cell.
         **Why, for the 4 line / scatter / line+symbol families (2026-11-15):**
         the axis record is a byte-COMPRESSED stream, and these records hold
         a tagged token whose payload packs MORE than one double, which the
         per-value token reader (``8T nn``, ``nn <= 8``) cannot split.
         `duplicates` / `multi_x`: X span ``89 10 <16 bytes>`` = the raw
         doubles -0.28 and 9.28 (Origin's from/to) in one token.
         `huge_tiny`: the same X shape, and Y ``82 0d <13 bytes>`` = the top
         5 bytes of -1e12 then all 8 of 1.1e13, with a step token tagged
         ``80`` (outside ``81..8f``). `log_range`: X decodes (``89 08``,
         one double), Y's from (1e-6) is a ``00`` control byte + an 8-byte
         literal after the ``08 01`` log flag, which the bare retry refuses.
         Real corpus: 126 of the 792 still-undecoded length-prefixed layer
         anchors (26 files; 61 in `Figure 3 and 4 amplitude`) open with such
         a packed X token. Book: decode the stream's control byte (the
         low nibble is not the zero-byte count: 0.25 and 3.25 both elide 6
         zero bytes as ``85`` / ``83``) before splitting packed payloads --
         a 13-byte payload has several 2-value splits, so fail closed until
         the rule is known.
   - [x] ~~**double_y: layer exists but is not recovered on 7 / 8
         specimens**~~ FIXED 2026-11-15 (`fix/plot-xy-import`). Cause: the
         second (right-axis) layer closes its axis-record separator with
         ``09`` instead of ``01`` (``01 | 0x08``), so no separator pass
         matched. New `opju_axis_sep_last` admits ``09`` in a THIRD pass, so
         every record that parsed before is byte-identical. Scorer: double_y
         layer 2 recovered on 8 / 8 (log_range's layer 1 is the packed-token
         gap above): curves 229 -> 237, drawn 263 -> 271, axes 870 -> 918,
         plot type +8 match, 0 wrong / 0 phantom. Real corpus vs main (359
         `.opju`): 709 layers in 28 files recovered (673 the coincident 2nd
         layer of a 2-layer page; the bit also marks panel layers, e.g.
         `SOP_meas`), 0 existing figures or books changed. Origin 2026b COM
         on all 709: `layer.x/y.from/to` 2,836 / 2,836 exact, `x/y.type`
         1,418 / 1,418, all 720 decoded curves are plots Origin draws on
         that layer with the same Y and X (`%Z` / `xof`); 871 Origin plots
         on them stay omitted (error bars and undecoded tokens).
   - [x] ~~**area/multi_x draws Y against the wrong X**~~ FIXED 2026-11-15:
         a SCORER defect, not an app one. The real apply's first branch
         (`buildOverlayDataset`) draws any figure whose curves span >= 2
         (book, X) blocks -- including one book's X,Y,X,Y sheet -- as an
         overlay, each Y against its own X; the mirror
         (`frontend_view.py`) modelled only `figureChannelSelection`'s
         single `xKey`. Mirror gained the overlay branch, pinned by two
         shared cases (pytest + vitest through `buildOverlayDataset`) and an
         end-to-end `applyOriginFigure` test
         (`store/originApplyMultiX.test.ts`). Scorer: drawn wrong 1 -> 0, no
         other cell moved. Real files were never affected.
   - [x] ~~**No quantized mapping for step and area**~~ FIXED 2026-11-15
         (`opju_plot_kinds`): curve record byte 76 ``0xcc`` (plot 204) ->
         `plotType: "area"` (drawn `fill: "under"`, Origin fills to Y = 0:
         `area/negative` PNG), a line record with connect byte 11 ->
         `plotType: "step"` (`step: "post"`); latent symbols not drawn.
         Specimens: 30 / 30 area records ``0xcc``, 27 / 27 step records
         byte 17 = 11, no other type carries either. Scorer: plot type 30
         omitted -> match (16 area + 14 step specimens' layers), 0 wrong.
         Real corpus: 0 of the decoded curve records carry either byte, so
         no real file changes.
   - [ ] **No quantized mapping for stacked area (214) or offset lines
         (waterfall)**: quantized cannot draw them from scratch yet (#13), so
         they stay the default line view (fail closed). There is also no
         dash field (the 139 planted dashes cannot be represented).
   - [ ] **The scorer does not model the double-Y apply**: each layer is
         scored on its own; `doubleYPartner` puts layer 2 on the y2 axis,
         which no cell checks yet.
6. **Category/statistics family import parity** — column, horizontal bar,
   stacked column/bar, floating column, histogram, box, violin, strip, and
   wiring `.opj`/`.opju` column/bar/histogram to the bar/stat renderers.
   Measured by the item 2 scorer (2026-11-15); bindings and metadata are
   item 5's first two gaps.
   - [x] ~~**Phantom book: the stacked plots' hidden helper book `CS`**~~
         FIXED 2026-11-15. `CS_1..n` are loose datasets: no window owns them,
         COM `WorksheetPages` / `doc -e W` never list `CS`, and the graph's
         `%Z` plots the source sheet, never `CS` (35 / 35 stacked + deleted
         specimens: 0 loose datasets plotted). New `opju_loose_books` drops
         every book whose name is no window's (case-insensitive, as Origin's
         names are; fail closed when the file has no windows or every book
         is loose). Scorer: sheets phantom 31 -> 0, every other cell
         unchanged. Real corpus vs main (359 `.opju`, COM on all 22 changed
         files): 111 books dropped (`CS`, `TableN`, `<Book>A` leftovers),
         0 of them a `WorksheetPages` book, 0 COM books vanished, 0 decoded
         curves / labels / values changed, 1 primary book now a real one
         (`CompareRc`: `Table1` -> `Book1`).
   - [ ] **Residual phantom books (pre-existing).** Kept although COM lists
         no such book: 184 `TableN` books in 10 files (they DO have a window
         header -- table objects, not `WorksheetPages`; e.g. `Hc2 data`
         `Table1..`, `Figure 3 and 4 amplitude` 68) and 35 books of 5
         graph-only projects (all loose, kept by the fail-closed rule:
         `BD_*_all`, `RSOS_*_all`, `F72_...TB_Product`).
   - [x] ~~**Box, violin and strip: no graph layer recovered on 33 / 33**~~
         FIXED 2026-11-15 (`fix/plot-category-import`). Cause: a category
         layer's axis record ENDS with `8x 35 08 00 00 02` (`02`, not `01`);
         a fourth, retry-only real-form pass admits `02` on the end separator
         only (`opju_axis_sep_last.SEP_END_02`; `02` on both separators --
         59 workbook-embedded records -- stays undecoded). Curves: Origin
         plots these with no X column (`xof` = `_A`, record X id 0), so a
         206 / 219 curve is kept from its Y alone (`x == ""`, `plotType`)
         and box / violin / strip is told by the page template
         (`opju_stat_plots`; `Box`/`BOX+DATA+`/`gBox` -> box, `Violin*` ->
         violin, `ColumnSca` -> strip, anything else -> omitted
         `box_kind_not_decoded`). The frontend opens the Stat Stage in that
         mode, one box per plotted column (`figureStatState`; scorer mirror
         `frontend_view.stat_view`, pinned by 3 new shared cases). Record
         byte 76 = Origin's `GetPlotType()` on every plot of all 231 built
         specimens. Scorer vs main `2f171d56`: box / violin / strip 0 -> 30
         specimens with curves, plot type and axes match; axes 870 -> 1,050
         match, curves 229 -> 301, drawn 262 -> 331, plot type 50 -> 85;
         0 new wrong / phantom. Real corpus vs main (359 `.opju`, COM
         `layer.x/y.from/to`, `GetPlotType()`, `range -w`, `xof` on all 10
         changed files): 50 new layers, 50 / 50 axes equal to Origin; 547
         newly drawn curves, 547 / 547 Origin's Y with no X and type 206 /
         219; 0 main curves lost. PNG review: every box-kind page is a box
         chart (some with data / half-violin overlays).
   - [ ] **Box / violin / strip residue.** `huge_tiny` (3 specimens) layer
         still not recovered. Real corpus: grouped (indexed) box charts and
         box curves whose X field does not decode are omitted
         (`stat_plot_x_not_decoded`, e.g. `fig04_box_raw_penguins` Graph9
         column A); `MergeGrap` / user templates naming no kind (FedPB
         `BoxplotCiteseer`/`BoxplotPubMed`, SOP_meas Graph80) omit
         (`box_kind_not_decoded`); `soil deep` Graph1 (Violin) curve records
         do not reconstruct; a box layer on a multi-layer page is omitted
         (`stat_layer_in_multi_layer_page`, SOP_meas Graph41 etc.); a
         rowless curve on sheet N with no sheet X (`x_sheet_unproven`,
         Degree-of-impact Graph10 / 4A) is omitted although it needs no X.
         Origin's box statistics (whisker rule, mean marker, data overlay)
         are not decoded: quantized draws its own default box marks, and
         every drawn box-family figure says so (`box_marks_not_decoded`
         fidelity omission). Overlays are not told from the template:
         SOP_meas Graph78 (template `BOX`) has distribution curves.
   - [ ] **Histogram residue.** 1-column histograms now open the Stat
         Stage histogram of that column (3 specimens; real corpus SOP_meas
         Graph37/38/42/45); BIN WIDTH / START are NOT decoded -- quantized
         uses its default bin rule, Origin its own (no COM readback found;
         decode the record's bin fields against a by-construction oracle);
         each drawn histogram says so (`histogram_bins_not_decoded`).
         Several-column histogram layers stay omitted
         (`histogram_of_several_columns`, 8 specimens; the Stat Stage bins
         one column: creation gap #15). `huge_tiny` not recovered. A
         1-row histogram (`single_point`) opens a stage that cannot bin one
         value.
   - [ ] **Column / bar layers not recovered** for {clean, descending_x,
         huge_tiny, masked_rows, nan_gaps, noisy} (column, bar, stacked
         column / bar, floating column): a different record mechanism from
         the box family's `02` end separator. Anchor `column/clean`.
   - [x] ~~**Plot type: 0 decoded on `.opju`**~~ PARTLY FIXED 2026-11-15:
         record byte 76 sets `plotType` for 206 (box / violin / strip), 219
         (histogram) and 203 (column) curves. A 203 curve keeps
         `plotType: column` (bars from zero at each X on the XY stage) only
         when it is its layer's ONLY column series: Origin draws several side
         by side, quantized's bars would overlap. Scorer: column
         `duplicates` / `single_point` plot type match; real corpus: 67
         curves in 22 files now draw as bars, COM: 67 / 67 are
         `GetPlotType()` 203, the only 203 of their layer, same X.
   - [x] ~~**Plot type residue: real corpus kinds drawn as lines.**~~
         PARTLY FIXED 2026-11-20 (`opju_bar_kinds`, `opju_hist_cumulative`,
         `docs/origin_re/plot_kinds.md`; plot type x page template x saved
         preview on every changed page). Drawn: one stacked area per layer
         as `area` (21 pages), the only 215 of a one-layer `Bar` page as a
         horizontal bar (8), several 203 / `StackColumn` 213 series on one
         unique, evenly spaced X as the Stat Stage bar chart grouped by X
         (`bar_layout`, 10 layers), `HISTPROB` histogram + cumulative-percent
         pages from Origin's own bin sheet (4, counts recomputed from the raw
         column). Left out (`plot_type_not_drawn`) instead of drawn as lines:
         pie / doughnut 225, 100 % (`StackColP`) or unproven stacks, several
         215, floating column 207, vector 218 (92 curves, every page
         preview-checked).
   - [ ] **Plot type residue.** Multi-series column layers on several X
         columns, uneven X or multi-layer pages still draw by line style;
         100 % stacked column (needs the layer's 100 % flag + a percent stack
         in the Stat Stage), grouped / stacked horizontal bars, floating
         column, pie and stacked bar have no renderer (#10-#12 creation gaps).
         Owner COM checks open: `SOP_meas` Graph67 orientation, `Graph_Template`
         Graph1's upright 215 plot (`plot_kinds.md`). The `.opj` reader's own
         `column` / `bar` mapping still overlaps multi-series bars.
   - [x] **Text X** (`text_categories`, 5 specimens, 10 curves): Origin
         plots against the text categories; quantized draws against the row
         index. The same 5 specimens hold the only category-family omitted
         labels (`label_is_short_name`).
         DONE (#784 category axes with text labels, F-087 / F-088; a text X on a later sheet is admitted for pies only, F-117); verified 2026-11-21 (Lane OD triage).
7. **Specialised family import parity** — polar, contour, heatmap, ternary,
   waterfall, bubble/colour-mapped scatter, vector, inset, axis break,
   multi-panel. Measured by the item 2 scorer (2026-11-15).
   - [x] ~~**Bubble / colour-mapped: the size / colour encoding is not
         decoded.**~~ FIXED 2026-11-15 (`fix/plot-specialised-import`). A
         curve token carries a plot-modifier block
         (`SYSTEM 03 00 ce 02 01 d0 02 06 <n>` + `"<desig>|<dataset>"`
         strings); `<desig>` is Origin C `COLDESIG_*` (9 SIZE, 18
         EDGE_COLOR). Oracle: Origin C `DataPlot::GetModifiers` over COM on
         every specimen and the whole real corpus (348 / 359 `.opju`
         loaded): bubble 9 -> C 7 / 7, colour-mapped 18 -> C 7 / 7; real
         18-entries 20 / 21 equal Origin's (the 21st names a book the plot no
         longer uses). Mode from the record + Plot Details trees: symbol size
         u16 @25 = 101 = size from the column; edge colour u32 @306 =
         `0x00400065` = colour MAP (without the `0x40` flag it is Origin's
         colour INDEX mode, `Analysed and Plotted Graph`). `opju_plot_kinds.
         apply_marker_modifiers` sets `sizeBy` / `colorBy` (a column of the
         curve's own sheet; the bogus 0.2 pt `symbolSize` of a bubble is
         dropped); the frontend maps them to `SeriesStyle.sizeBy` /
         `colorBy` (`originFigureSelection.withMarkerColumns`, lazy chunk),
         and the figure says `marker_scale_not_decoded` instead of
         `marker_encoding_not_decoded`. Scorer vs main `c40ed030`: plot type
         123 match / 14 wrong -> 138 / 0 (14 bubble + colour-mapped, +1
         polar below), 0 new wrong / phantom. Real corpus: 0 files change
         (every real modifier fails closed).
   - [ ] **Marker residue.** Origin's bubble size scale (`Scale` 24.0,
         `SizeUnit`) and colormap (a 10-level rainbow, `ColorMap` levels)
         are not decoded: quantized draws its own size range / viridis
         (`marker_scale_not_decoded`; also #18 bubble axis padding). Real
         corpus colour modifiers stay plain scatter: `SOP_meas` SHAP plots
         (edge colour flag `0x48`, 18 curves), `YbMnBi2` (`0x40` with another
         low byte; 18 + 19 fill colour), `Analysed and Plotted Graph` (index
         colours: needs a categorical-colour mapping, not `colorBy`). Prove
         each mode with Plot Details trees (`l7s/qz_fmt.c` pattern) before
         reading it. Other modifiers seen (COM): 32 plot-label form, 37 / 38
         line style / width, 39 / 40 / 44 / 62 / 83 bar-width / pattern /
         grouping, 53 matrix heatmap, 13 / 14 vector XYXY ends (plot 218,
         `30流场` / `50流场`, not reported by `GetModifiers`).
   - [x] ~~**Heatmap / contour / ternary bindings.**~~ FIXED 2026-11-15
         (`fix/plot-matrix-import`, `opju_map_plots`). A map plot's token
         names a dataset the XY id table leaves out: a matrix object's own
         column record (code 0, no short name, flags 01/60; one per book page)
         for 105 heatmap / 226 contour / 220 image, or a Z column (code 5,
         flags 00/60; offset 35 = its Y, whose 35 = its X) for 243 XYZ contour
         and for a scatter on a `Ternary`-template page (A, B, C = X, Y, Z).
         Oracle (Origin C `GetRangeString` / `GetPlotType` /
         `GetCoordinateType` over COM): specimens `[Mat]MSheet1!1`,
         `[XYZ]Sheet1!(A,B,C)`, `[Tern]Sheet1!(A,B,C)` coor 2 -- each equal to
         the chain. The figure gets `map` / `ternary` only when that plot is
         the layer's only token (fail closed: `map_plot_not_decoded`, and a
         map plot type is never drawn as an XY line); a matrix-only project
         now has an id table, so its graph pages are named. Frontend (lazy,
         `lib/originFigureMap.ts`): a matrix map opens the Map tab on the
         matrix (contour lines on for contour), an XYZ contour only when the
         Map tab's default picks equal Origin's (X, Y, Z), a ternary opens the
         ternary workshop with A, B, C explicit (`lib/ternaryPending.ts`; #17
         is the from-scratch default). Scorer vs main `76b6c73e`: curves 310
         -> 313, drawn 340 -> 343, plot type 138 -> 141 (contour_matrix,
         contour_xyz, ternary), 0 new wrong / phantom. Real corpus (359
         `.opju`): 2 files change, 5 plots gain a map, all COM-equal:
         `fig05_heatmap_flights` Graph1 226 contour of MBook1, `Fig3_c` Graph2
         105 heatmap of MBook2, Graph3-5 of MBook1; axes 0.5..12.5 / 0.5..30.5
         exact both ways, linear (Plot Details `ScaleType` 0), colour limits
         104..622 / -4..4 = the matrices' own Z extent, which is what the Map
         tab's auto limits draw (`map_scale_not_decoded`: not read from the
         file).
   - [ ] **Map residue (2026-11-15, COM-measured).** (a) Colour scale not
         decoded: Plot Details `ColorMap` Min / Max / ScaleType / MajorLevels
         sit ~560 bytes after the map token (`80 08 <min f64> 83 02 <max>
         85 09 <increment> <levels>` on the heatmap specimen), outside the
         519-byte curve record; the specimen's -0.42..1 is Origin's rounded
         range, not the data's -0.416..0.99997. (b) The `heatmap_matrix`
         specimen's layer is not recovered: its axis span is bare 8-byte
         literals (-0.0263..1.0263) after a `89 11` / `80 11` sparse header
         that the Y-span start scan does not authenticate. (c) 8 plots in the
         4 `jiahehu2000` `.opju` (Matrix01 heatmap + Matrix02 colour-bar
         layer, panel anchors with an `84 01 07` separator) stay unrecovered;
         their heatmap Y axis is REVERSED (COM `y.from` 5.5 -> `y.to` 0.5),
         which the Map tab cannot draw, so they need that first. (d) 41
         heatmap plots on virtual matrices (worksheet ranges, `VM*`, e.g.
         `SOP_meas` SHAP, `Supplemetary_Fig_10`) and 2 XYZ contours on loose
         `[??]` datasets (`30流场` / `50流场`, now `map_plot_not_decoded`) are
         not bound; neither is the virtual-matrix 226 contour (`pedotpss`).
         (e) A ternary workshop already open on the same dataset keeps its
         picks (the A, B, C hand-off is taken when it re-derives them).
   - [x] ~~**Polar layers are not rebuilt.**~~ FIXED 2026-11-15
         (`fix/plot-specialised-import`). A one-layer `Polar`-template page
         whose curves share one (book, X) and whose theta axis runs 0..360 is
         kept and tagged `coordinates: "polar"`; the apply opens
         `polarMode` (`figurePolarState`). Oracle: `GraphLayer::
         GetCoordinateType()` = 1 (polar) on the specimen, plot `(A "theta",
         B "r")`. The template signal misses nothing real: COM over 348 / 359
         real `.opju`, all 7,536 graph layers are Cartesian (0 polar, 0
         ternary). Scorer: polar curves / plot type / colour / width omitted
         -> match. Any other polar page stays omitted
         (`layer_kind_not_decoded`).
   - [ ] **Offset-stacked (waterfall) layers stay omitted**
         (`layer_kind_not_decoded`): quantized cannot draw them yet (#13 /
         cloud), so the curves are left out rather than drawn un-offset
         (8 specimens; 4 real pages in 2 files, none with a decoded curve).
   - [ ] **Vector XYXY (218): 14 real plots**; the 13 / 14 modifiers above
         name the end columns. (Real-corpus map census, COM `GetPlotType()`:
         105 heatmap 53 = 12 matrix (4 shipped, 8 `jiahehu2000`) + 41 virtual
         matrix; 226 contour 2 = 1 matrix (shipped) + 1 virtual; 243 XYZ
         contour 2 (loose datasets); 0 ternary layers.)

### Creation gaps found by check 2 (cloud items, owner decision 2026-11-15)

Evidence for every item below: `tools/plot_corpus/scratch_run.py` over the
231 ok specimens (scorecard in `<review>/scorecard.md`, side-by-side
`<review>/index.html`); "N/M" = specimens of that type affected.

10. **Horizontal bar** — no way to create one (11/11 `bar` specimens
    unbuildable). `SeriesStyle.bars = "horizontal"` already renders on the
    canvas (`lib/uplotOrient.ts`) and in export (`calc/figure_orient.py`),
    but only an Origin import sets it: no gallery tile, Series card control
    or Stat Stage orientation.
    **PARTIAL 2026-11-21:** gallery tile "Horizontal Bar" and a Series card
    "Bars" control (None / Vertical / Horizontal) now create it on the XY
    stage (screen and export share `SeriesStyle.bars`); Stat Stage
    orientation is still open.
11. **Horizontal stacked bar** — 11/11 `stacked_bar` unbuildable: the Stat
    Stage bar is vertical only and `bars: "horizontal"` has no stacking.
    **ADDED 2026-11-22 (lane A2), residual: verify against Origin:** gallery tile "Horizontal Stacked Bar"
    (`SeriesStyle.stack` + `bars: "horizontal"`; screen `lib/uplotStack.ts` /
    `uplotBars.barPaths`, export `calc/figure_bars.stacked_series`, horizontal
    `bottom` -> `left` in `figure_orient`). The cursor readout still shows each
    series' own value, not the running total.
12. **Floating column** — 9/9 `floating_column` unbuildable: no bar that
    spans two Y columns (low to high); every bar starts at zero.
    **OPEN (lane A2, not reached):** no floating-column creation exists yet;
    `stack` only builds cumulative bars. Needs a low/high pair of Y columns
    (a bar base from a second column) on screen and in `figure_bars`.
13. **Stacked area** — 8/8 `stacked_area` unbuildable: `fill` is
    under-zero or between two curves, never cumulative on the previous
    series.
    **ADDED 2026-11-22 (lane A2), residual: verify against Origin:** gallery tile "Stacked Area"
    (`stack` + `fill: "under"`): the line at the running total, the fill
    between the two totals, on screen (`stackedAreaPaths`) and in the export
    (`stack_base` -> `fill_between`); autoscale covers the totals.
14. **Column / stacked column per X row** — 8/11 `column` and 8/11
    `stacked_column` built the wrong figure. With a numeric X the gallery's
    Column routes to the Stat Stage, which has no category column and
    falls back to ONE bar per Y column (its mean ± SE, "n=50"); Origin
    draws one bar per row at its X value, one series per Y column.
    `duplicates` (1 Y) gives one bar for 20 rows. Only text-category X
    (`text_categories`) and one-row data match. The XY-stage bar renderer
    (`SeriesStyle.bars`) would draw Origin's figure but has no creation UI
    (shared with #10). The bars also take no Series card colour (11/11
    styles wrong on both types).
    **PARTIAL 2026-11-21:** the gallery's "Column per X row" tile draws one
    bar per row, one series per Y column, filled with the Series card colour
    (XY-stage bars). Stacked column per X row is still open (needs a
    cumulative bar base on screen and in `calc/figure_bars.py`, plus the
    autoscale).
    **ADDED 2026-11-22 (lane A2), residual: verify against Origin:** gallery tile "Stacked Column per X row"
    (`SeriesStyle.stack`; screen + export + autoscale totals).
15. **Histogram of several columns** — 8/11 `histogram`: the gallery's
    Histogram bins only the first plotted column; Origin bins every
    selected Y column in one graph. `single_point` (1 row) exports nothing
    (the stage needs >= 2 values); Origin draws a one-bin histogram.
    **PARTIAL 2026-11-21:** a single finite value now draws a one-bin
    histogram (screen and export, `calc/statplots.histogram`; a distribution
    fit still needs >= 2 values). Binning several Y columns in one graph is
    still open.
    **ADDED 2026-11-22 (lane A2), residual: verify against Origin:** the Stat Stage histogram has a "+ columns"
    picker (`statPicks.histCols`); several columns are binned on shared edges
    (`calc.statplots.histogram_multi`, `/api/statplots/histogram-multi`), drawn
    as translucent bar sets with a legend on screen (`statRenderHist.ts`) and in
    the export (`calc/figure_hist_multi.py`). A distribution fit stays a
    single-column feature (ignored for several columns).
16. **Double-Y axis assignment** — 6/8 `double_y` put the wrong curve on the
    right axis: `plotTypePatch("doubleY")` moves the LAST plotted column to
    Y2, Origin's `DOUBLEY` template puts the SECOND Y column on the right
    and keeps the rest on the left (measured: layer 2 holds only `y2` of
    `y1,y2,y3`). Both agree only with exactly two Y columns.
17. **Ternary from an A,B,C sheet** — 1/1 `ternary` wrong axis order: the
    gallery Ternary tile refuses the sheet ("Needs three composition
    columns") because the first CSV column imports as the X axis, leaving
    two channels; Plot > Ternary diagram... builds it, but its default picks
    (`auxColumns.defaultPicks`) take channels first and the X column last,
    so the axes come out B, C, A instead of A, B, C.
18. **Bubble axis padding** — 5/7 `bubble`: X runs exactly to the data
    ([0, 10]) so edge bubbles are cut in half; Origin pads the axis to the
    largest bubble ([-0.68, 10.46]).
19. **Polar line width** — the polar export always draws
    `POLAR_LINE_PX` (`lib/polarFigureSpec.ts`), so a Series card width
    (2 pt in the corpus) never reaches a polar figure.

### Round-trip exporter gaps found by item 9 (2026-11-16)

Evidence: `tools/plot_corpus/roundtrip_run.py` + `roundtrip_origin.py` +
`score_roundtrip.py` over the 155 check-2 matches x 4 paths (620 exports
opened in Origin 2026b over COM); scorecard in
`$SCRATCH/plot_corpus/roundtrip/fixed/scorecard.md`.

20. **`.ogs` as downloaded imports nothing** (bug, 155/155 exports): the
    script names its CSV relatively (`impASC fname:="x_data.csv"`) and Origin
    2026b resolves a relative `impASC` path against neither `cd` nor the
    script's folder (measured: `cd <folder>` then `run.file` -> 0 rows, an
    empty book, `plotxy` fails). Every other `.ogs` result in the scorecard
    was measured with the CSV path made absolute. Needs a way to locate the
    CSV (embed the data in the script, or prompt with `dlgFile` when the
    relative name does not exist), then a re-run of the round trip.
21. **`.ogs` graph is always a scatter** (bug, plot type 246 wrong / 49
    match): `plotxy ... plot:=201` is hard-coded and `GraphSpec` has no
    plot-type field, so line (200), line+symbol (202), area (204), column
    (203), box (206), histogram (219) and stacked column (213) arrive as
    scatter. The item-9 `plotxy` fix made 196 of these visible (they had no
    graph at all before). Needs the series mode -> Origin plot code in the
    `.ogs` request (frontend `runExportOrigin` + `GraphSpec`). The `.ogs`
    also writes no X-error bars (6 `dx` columns not plotted), no curve
    styles (295 missing) and no axis range unless the user typed one.
22. **`.opj` / Send to Origin / `origin-project` carry no graph** (feature
    gap, 295 curves each): the writers take DataStructs only. A graph needs
    a graph-window writer for `.opj` (the import side's
    `opj_graph_windows`/`opj_curves` model) and a `plotxy` step for COM.
23. **`.opj` worksheet shows 161 of 20,000 rows** (bug, 18 `large_n`
    exports): COM `wks.nrows` 20,000 and `col(1)[20000]` is right, but
    `wks.maxrows` is 161 and `GetWorksheet` returns 161 rows -- the sheet's
    row count is not the u16 the writer sets at `Pd`+82 (or a second field
    caps it). Needs a COM probe of which header field Origin reads.
24. **Dates exported as Unix seconds** (bug, 5 `dates` specimens x every
    path): a date X arrives as 1.77e9 (seconds since 1970) where Origin's
    own column holds day numbers (2461041); no path converts or marks the
    column as a date.
25. **Text category column** (bug, 2 `text_categories` specimens x every
    path): the imported text X is exported as a Y column after a phantom
    `Sample Index` X; `.opj` and COM write its level CODES (0, 1, ...) instead
    of the text; the `.ogs` draws it as a curve.
26. **Row masks** (feature gap, 11 `masked_rows` exports per path): no path
    writes an excluded/masked row.

## Tier 3 — Nice-to-Have

None open.

## Completed

- ~~**#9 Round trip quantized → Origin**~~ (2026-11-16) — every user path that
  targets Origin, surveyed: File > Export Origin (.ogs) (`/api/export/origin`),
  File > Export Origin project (.opj) (`/api/export/opj`), File > Send to
  Origin (COM) (`/api/export/origin-com`), plus the API-only
  `/api/export/origin-project`; not round-tripped: `/api/export/xrd-csv`
  `fmt=origin` (the menu always sends `standard`, XRD only) and `qz convert`
  (Origin -> CSV/XLSX only). `tools/plot_corpus/roundtrip_run.py` re-runs
  check 2 and captures the bodies the app's own commands build on that
  screen (`frontend/src/test/plotCorpus/originExports.ts`);
  `roundtrip_origin.py` opens each export in an owned `Origin.Application`
  (COM sends through the shipped `send_to_origin` with this session's app
  handle) and reads books + graphs back with the harness's oracle reader;
  `score_roundtrip.py` / `roundtrip_compare.py` classify match / wrong /
  missing / phantom per (path x plot type x family), unit-tested without
  Origin (`tests/test_plot_corpus_roundtrip.py`). 155 check-2 matches x 4
  paths = 620 exports. Fixed here (each re-proven by the Origin readback;
  no value the exporter writes differently became wrong, but the `plotxy`
  fix made the hard-coded scatter visible on 196 more curves -- plot type
  50 -> 246 wrong, 224 -> 0 missing; see #21):
  - `.ogs` multi-curve graph: Origin 2026b REJECTS the `(x,y):(x,y)` join, so
    every multi-curve script stopped with no graph; now `((x,y),(x,y,e))`
    (curves 71 -> 295 match, 224 missing -> 0; two y2 channels proven too);
  - `.ogs` log axes wrote `layer.x.type = 1`, which reads back LINEAR (log10
    is 2): axis type 2 wrong -> 0, 140 -> 310 match;
  - `.ogs` written without a BOM is read as ANSI: 44 non-ASCII long names
    mojibake -> 0 (UTF-8 BOM);
  - `.ogs` book titled after the CSV (`x_data.csv`): title restored after
    `impASC` (155 wrong -> 0 on `.ogs` and `origin-project`);
  - `.opj` window title read as `"name@${[0|]}"`: NUL before the marker
    (155 wrong -> 0);
  - Send to Origin set no designations (19 Y-error / X-error / second-X
    columns arrived as Y): `wks.col.type` via `range`, and the command now
    sends the live error roles + Set As map (19 wrong -> 2, both the text
    category column of #25).
  Remaining defects booked as #20-#26.

- ~~**#8 Commit the specimens + ratchet**~~ (2026-11-15) — 233 specimens
  (231 `.opju` + PNG + `oracle.json`, 2 refused; 28 MB) committed to private
  `test-data/origin/generated/` with README + regenerate command.
  `tests/test_plot_corpus_import_floor.py` (realdata, ~3 s) scores them and
  asserts 0 wrong / 0 phantom in every check and match counts equal to the
  pins in `tests/fixtures/plot_corpus/import_floor.json` (curves 313, drawn
  343, values 808, column_meta 1709, plot_type 141, axes 1098, styles 414,
  error_bars 12); a rise fails the test until the pin is raised.
- ~~**#2 Check 1 — Origin → quantized import scorer**~~ (2026-11-15).
  `tools/plot_corpus/score_import.py` imports every specimen through the
  import route's own composition (`read_origin_project_all` →
  `drop_empty_library_books` → `origin_figures_and_fidelity`) and scores it
  against `oracle.json` and the planted data: curve bindings, the curves the
  frontend would draw (`frontend_view.py`, a mirror pinned to the real
  frontend by shared cases asserted in pytest AND vitest), values, column
  metadata, plot type, axes, styles, error bars, phantom sheets and figures.
  Every item is match / wrong / phantom / omitted-with-reason;
  `scorecard.json` + `scorecard.md`. Comparison logic is unit-tested on
  synthetic fixtures (`tests/test_plot_corpus_import_score.py`).
  First run, 231 scored + 2 not built: values 808 / 808 exact, axes 804 match
  / 0 wrong / 630 omitted, curves 0 / 484 bound, column metadata 0 / 1,717,
  styles 0 / 750, plot type 13 match (line by default) / 226 omitted.
  WRONG / phantom: 31 phantom books (26 hidden `CS`, 5 deleted sheet),
  41 phantom and 1 wrong drawn curve. Every gap is booked under items 5-7.

- ~~**#1 Plot-corpus harness**~~ (2026-11-15). Built in `tools/plot_corpus/`
  (README there), with `tests/test_plot_corpus_tools.py` running without
  Origin.
  - `generate.py` / `families.py` write 23 seeded families, each with a
    `.truth.json`. Output is byte-identical for the same seed. Designations,
    display units and the Origin date epoch are imported from quantized.
    Each family asserts its own edge case. "Large" is 20,000 points.
  - `origin_build.py` builds every applicable (family × type) with Origin's
    own menu recipe, applies known styles, saves `.opju`, exports a PNG, and
    writes an `oracle.json` read back from Origin. That readback covers plot
    type, `%Z` per layer, `[Book]Sheet!Col` and X dataset per plot, axis
    from/to/type, colour, line width/connect/dash, symbol kind/size, and the
    book's sheets.
  - `origin_session.py` refuses to start beside another Origin. It records
    the `-Embedding` PID with its creation time and kills only that exact
    process, from `finally`, `atexit`, a KILL_ON_JOB_CLOSE job object and a
    per-specimen deadline. In the scan the deadline caught Origin dying on
    code 231, and the run continued on a fresh instance.
  - **Plot-type readback found:** Origin C `DataPlot::GetPlotType()`, loaded
    with `run.LoadOC` (backslash path, CRLF file). LabTalk `layer.plotN.*`,
    `get %C -a..z`, the COM `DataPlot`/`Theme` tree and embedded `originpro`
    all lack a type property. Verified against PNGs; see the code table
    above.
  - **Codes probed:** contour, heatmap, ternary, polar, violin, step, strip,
    bubble/colour-mapped, and codes 231-420. All recorded in the table above.
  - **Corpus run.** 233 specimens across 25 types × 23 families (in
    `$SCRATCH/plot_corpus/corpus`, NOT in test-data; item 8 commits them).
    231 are ok and every read-back type is in the expected set. The other 2
    are input refusals: floating column needs >= 2 Y, and `duplicates` and
    `single_point` have one Y.
  - **Student refused no type.** What does not reach the 2D corpus is a
    recipe or scope matter, not a refusal: heatmap from an XYZ sheet made no
    graph (heatmap is built from the matrix family); the waterfall template
    is 3D; vector XYXY (218) made no graph from the probe selection.
- ~~**#3 Check 2 — quantized-from-scratch scorer**~~ (2026-11-15). Built in
  `tools/plot_corpus/scratch_*.py` plus the vitest recipe harness
  `frontend/src/test/plotCorpus/`; `tests/test_plot_corpus_scratch.py` and
  `recipeHarness.test.tsx` run without Origin or the corpus.
  - **Route.** Each family's graphed sheet is written as the CSV a user
    opens and imported through the app's own `/api/parsers/upload` (a
    matrix as long-form X,Y,Z; dates as ISO dates). The recipe table
    (`scratch_recipes.py`) names the user's clicks; the harness replays them
    on the real store (worksheet Set As, masked rows excluded, log axes,
    `applyPlotType`, Series card modes/styles, Stat Stage picker, Map contour
    toggle, Plot > Ternary diagram...) and builds the request with the app's
    own export entry for what is on screen: `buildStageFigureSpec`, the
    mounted `<StatStage>`'s registered exporter, `fetchMap` +
    `mapFigureBody`, `buildTernaryRequest`. The app's `/api/...` calls go to
    a live in-process backend, so nothing on the path is mocked. Each request
    is posted to its export route at PNG; `/figure-hitmap` gives an XY
    figure's drawn axis limits.
  - **Scoring** vs `oracle.json`: type, curves (Y columns), binding (each
    curve's drawn X points against Origin's X column, error-bar companions,
    Y2 membership, ternary axis order), values, axes (scale, range within
    5 % of span) and styles. `match` = built and the first four ok.
  - **First run (231 ok specimens): 191 built, 158 match, 40 unbuildable.**
    Matching every specimen: line, scatter, line+symbol, area, step, y-error,
    waterfall offset, polar, box, violin, strip, bubble, colour-mapped,
    contour (XYZ and matrix), heatmap. Unbuildable: horizontal bar, stacked
    bar, floating column, stacked area (#10-#13). Built but wrong: column and
    stacked column (#14), histogram (#15), double-Y (#16), ternary (#17).
    Axis ranges differ on 7/18 XY specimens per type (Origin pads to a tick,
    matplotlib to round numbers; area bases at 0 in Origin) and bubble
    padding (#18); styles reach the request everywhere except stat bars
    (#14) and polar width (#19).
  - Review page with Origin's PNG beside quantized's for every specimen:
    `scratch_run.py --out <review>` writes `index.html`, `scorecard.md`,
    `scorecard.json` (run output stays out of the repo).
- ~~**#4 First scorecard**~~ (2026-11-15). `tools/plot_corpus/scorecard.py`
  (+ `scorecard_page.py`) merges check 1 and check 2 into one row per
  type x family: per import dimension (curves / plot type / axes / styles /
  labels / values) the worst-cell verdict wrong > phantom > omitted > match
  with counts, check 2 built / match / unbuildable, and the owning plan
  item. Writes `scorecard.md`, `scorecard.json` and an owner review page
  (`index.html`: Origin PNG | quantized import | quantized from scratch;
  the import column is a placeholder because `score_import.py` scores the
  decoded figure and the frontend's drawn curves but rasterises nothing).
  Merge logic unit-tested (`tests/test_plot_corpus_scorecard.py`). Run on
  main `4b544c8e`, 233 specimens: import curves 116 specimens match / 1
  wrong / 114 omitted, plot type 43 match / 14 wrong (bubble + colour-
  mapped drawn as scatter) / 174 omitted, axes 138 / 0 / 93 omitted, styles
  58 / 0 / 102 omitted (partly the missing dash field), labels 223 / 0 / 6
  omitted, values 231 / 231 match, phantoms 0; from scratch 191 built, 158
  match, 39 unbuildable (+1 failed build, 2 specimens Origin refused).
