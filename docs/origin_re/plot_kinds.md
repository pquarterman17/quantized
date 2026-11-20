# Column, bar, stacked, pie and histogram + probability plots (2026-11-20)

Before this change a `.opju` curve whose plot type quantized did not map was
drawn by its line style. A pie's slices, a stacked column's unstacked tops,
a floating column's two ends and a horizontal bar chart all came out as lines
(class D of the visual sweep). `io/origin_project/opju_bar_kinds.py` now
resolves those plot types per layer, and `opju_hist_cumulative.py` rebuilds
Origin's histogram + cumulative-percent page. `.opj` is unchanged: the public
and owner `.opj` files hold only 200-203, 215 and 219 curves, all mapped
before.

## The signals

**Plot type.** Byte 76 of the curve record, equal to Origin C
`DataPlot::GetPlotType()` (mod 256) on every plot of the 231 built
`tools/plot_corpus` specimens (Origin 2026b Student, 2026-11-15; codes in
`plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md` "Plot-type codes").

**Page template.** The graph page header names the template the page was
made from, cut to 9 characters (`opju_layer_kind.page_layer_kind`). It is a
field independent of the curve record. Public corpus, every decoded curve
code by its page's template (kept and left-out curves):

| template | codes on its pages |
|---|---|
| `StackArea` | 214 x21 |
| `StackColu` | 213 x19 |
| `StackColP` | 213 x6 |
| `Bar` | 215 x12, 203 x2 (the two `LSA_fig6` mixed layers), undecoded x4 |
| `Doughnut` | 225 x19 |
| `Pie2D` | 225 x1, undecoded x5 |
| `FloatCol` | 207 x7 (plus its scatter / error plots) |
| `HISTPROB` | the 4 histogram + probability pages: 219 (row-less) + 200 |

Negative controls: no 200-202 line or scatter curve sits on a `StackArea`,
`StackCol*` or `Doughnut` page (a `FloatCol` page carries its own scatter),
and no 213 / 214 / 225 curve sits
on a line, scatter or column template page. Codes outside a matching template:
213 on `PAN4` (12), `MergeGrap` (16) and unnamed pages (8); 215 on `LineSymb`
(10, `SOP_meas` multi-panel pages) and `PAN2HORZ` (4); 225 on `MergeGrap` (2).

**Rendered oracle.** Origin's saved preview of each page
(`graph_preview.py`, `tools/visual`), checked by eye against quantized's
render of the same page (`origin_preview_shots.mjs`).

## What is drawn

| kind | rule | pages (public) | preview check |
|---|---|---|---|
| stacked area (214), one per layer | a stack of one is the series: `area` (fill to 0) | 21 (`Figure_14/16/17`, all `StackArea`) | filled curve, same shape |
| horizontal bar (215), only curve of a one-layer `Bar` page | `bar` (turned plot, `lib/uplotOrient`) | 8 (`LSA_fig6` x7, `SOP_meas` Graph67) | `LSA_fig6` horizontal; Graph67's preview is upright, but the same V/W plot is drawn horizontally in `SOP_meas` Graph65 panel e, values equal (stale small preview suspected) |
| stacked column (213), one series, not on a `StackColP` page | a stack of one: `column` (a 100 % stack of one is left out) | 1 (`SOP_meas` Graph20) | upright columns |
| several column series (203) on one X | `bar_layout: grouped`: Stat Stage bar chart grouped by X | 8 (`fig_6_a` G1, `fig_7_a`, `5_sidechain` x2, `Supplemetary_Fig_9`, `Figure_1`, `Figure_2`, `TEA_ExcelGraphs` Graph2) | bars side by side per X, same order and heights |
| several stacked columns (213) on a `StackColumn` page | `bar_layout: stacked` | 2 (Etna `origin.opju` Graph17 / 19) | same stack order (first plot at the bottom), heights |
| histogram + cumulative percent | layer 1 re-bound to Origin's bin sheet (below) | 4 (`SOP_meas` Graph37 / 38 / 42 / 45) | bars 41 / 8 / 2 (Graph37), cumulative line on the right axis |

A grouped / stacked layer is drawn only when the X (from the imported book)
holds unique, evenly spaced values where finite, so one Stat Stage category
per row sits where Origin's bar does, and no curve carries an error bar.
The Stat Stage groups by X only for this pick (`statPicks.withPickedXGroup`;
X is otherwise never offered as a group). Each figure says
`bar_marks_not_decoded` (quantized's own colours, width, gaps; the stage also
shows its `n=1` count labels until toggled off).

## Histogram + probabilities

Origin's `HISTPROB` page is two layers: layer 1 bins a column (row-less 219),
layer 2 draws the cumulative percent from the bin table Origin writes to a new
sheet of the same book (`Book@N`: bin centre, counts, cumulative sum,
cumulative percent). The rule, every part required:

* exactly two decoded layers, equal frames and X ranges;
* layer 1's only curve: a row-less histogram of `H`'s column `T`;
* layer 2's only curve: on a sheet `H@N`;
* `H@N`'s X (layer 2's X) is finite, strictly increasing, evenly spaced
  (width `w`), and another column of `H@N` EQUALS the bin counts of `T`'s
  finite values over the edges `X - w/2 .. X[-1] + w/2` (every value inside;
  left- or right-closed bins).

The counts are recomputed from the raw column at import, so the bars are
Origin's bins by construction. Layer 1 is re-bound to that column as a
`column` plot (`histogram_source` keeps `{book: H, y: T}`), and the page
draws as a two-layer double-Y figure. Not decoded: Origin's edge-to-edge bars
(`bar_width_not_decoded`; quantized keeps its 60 % rule) and the cumulative
line's step connect.

## Left out (`plot_type_not_drawn`)

Each was drawn as lines before. Each preview shows a different figure:

| kind | pages | why |
|---|---|---|
| pie / doughnut (225) | `soil deep` Graph3, SOILDEEP1; `RSOS_SC_micstruc` / `RSOS_TC_micstruc` *_CIR | no pie renderer |
| 100 % stacked column (213, `StackColP`) | `fig_6_a` Graph2, Graph3 | the Stat Stage has no 100 % stack; preview 0..100 % from raw counts |
| stacked column on a user template (213) | `Graph_Template` / `Graphs` 32New, 32New_wMean, CQITCRLayerMod (layer 4); `Fig_3` Graph2 layer 2 | 100 % or plain stack not proven |
| several horizontal bars (215), or 215 beside 203 | `LSA_fig6` Graph6 / 8, `TEA_ExcelGraphs` Graph9, `SOP_meas` Graph14 layer 6, `Graph_Template` / `Graphs` Graph1 | grouped horizontal bars are not drawn; `Graph_Template` Graph1's 215 plot is upright in its preview |
| 215 on a multi-layer page | `SOP_meas` Graph65 layer 5 | a turned panel inside a page is not drawn |
| floating column (207) | `Degree of impact` Graph26, 511, 512 | no floating-column renderer |
| vector XYXY (218) | `30流场` Graph6 / `50流场` Graph10 layer 2 | no vector renderer |

Kinds still left as before: several 203 series on several X columns (one
`(book, X)` per curve: `optimal_MOI` x6, `sm_X5` x3, `fig03_bar_sem_tips`),
on an uneven X (`SOP_meas`), in mixed layers or on multi-layer pages draw by
their line style, as on `main`; several-column histograms
(`histogram_of_several_columns`, `SOP_meas` Graph7/8/9/16/21, `HistStack`
pages); box layers on multi-layer pages (`stat_layer_in_multi_layer_page`);
offset-stacked layers; templates naming no box kind.

## Owner checks (COM) left open

* `SOP_meas` Graph67: `GetPlotType()` and the layer's X/Y axis orientation
  (its preview is upright, Graph65 panel e draws the same plot sideways).
* `Graph_Template` Graph1: which layer holds the 215 plots and why the
  preview's bars are upright (an exchanged-axes layer would explain both).
* A `StackColP` page: confirm `GetPlotType()` 213 and the 100 % flag's home
  in the layer, so 100 % stacks can be drawn instead of left out.

## Corpus delta (sweep2, `main` 97a8be72 -> this change)

Public (351 files): curves 7,841 -> 7,753, figures with curves 2,966 -> 2,949,
books and actionable figures unchanged. -92 curves left out as above, +4
histogram layers drawn; 21 + 8 + 1 curves re-kinded (area, horizontal bar,
column) and 10 layers moved to the Stat Stage bar chart. Owner corpus (104
files): no change (every owner curve is 200-202).

## Ledger entries (to merge)

For `docs/origin_re/DECODE_LEDGER.md`. One line per fact or fix:
field/behaviour → evidence → guarding test. `T` = `tests/test_io_origin_opju_bar_kinds.py`.

* curve record byte 76 = `GetPlotType()` (mod 256); 213 / 214 / 215 → provisional `stacked_column` / `stacked_area` / `bar`, 205 / 207 / 208 / 216 / 218 / 225 → `not_drawn` → 231 `tools/plot_corpus` specimens, COM `GetPlotType()` (Origin 2026b, 2026-11-15) → `T::test_plot_type_byte_sets_the_provisional_kind`, `T::test_other_plot_types_get_no_layer_kind`
* 214, the only stacked-area plot of a layer → `area` → `StackArea` template on all 21 public pages, previews (`Figure_14/16/17`) → `T::test_single_stacked_area_is_an_area_and_single_stack_a_column`, `T::test_realdata_stacked_area_and_horizontal_bar_pages`
* 213, the only stacked-column plot of a layer and not on a `StackColP` page → `column` → `SOP_meas` Graph20 preview (`StackColu`) → `T::test_single_stacked_area_is_an_area_and_single_stack_a_column`, `T::test_single_series_on_a_100_percent_stack_page_is_left_out`
* 215, the only curve of a one-layer `Bar`-template page → `bar` (horizontal) → `LSA_fig6` Graph1-5/7/9 previews (horizontal); CONTRADICTED by `SOP_meas` Graph67 (its preview is upright) → `T::test_single_horizontal_bar_kept_only_alone_on_a_one_layer_bar_page`, `T::test_realdata_stacked_area_and_horizontal_bar_pages` (Graph67 itself UNGUARDED; owner COM check open)
* several 203 series on one sheet + one unique, evenly spaced X, one-layer page, no error bars → `bar_layout: grouped` (Stat Stage bar grouped by X) → previews `fig_6_a` G1, `fig_7_a`, `5_sidechain`, `TEA_ExcelGraphs` Graph2 → `T::test_several_columns_on_one_x_are_a_grouped_bar_chart`, `T::test_grouped_needs_unique_evenly_spaced_x`, `T::test_grouped_fails_closed`, `T::test_realdata_grouped_stacked_and_pie`, `frontend/src/lib/originFigures.test.ts::a grouped / stacked column layer opens the Stat Stage bar chart grouped by its X`
* several 213 series on a `StackColu` page (same gates) → `bar_layout: stacked` → Etna `origin.opju` Graph17 / 19 previews → `T::test_stacked_columns_need_the_stackcolumn_template`, `T::test_realdata_grouped_stacked_and_pie`
* Stat Stage offers X as a group only while a saved pick groups by X (`statPicks.withPickedXGroup`); the `[-1, ""]` pick round-trips → code read + unit test → `frontend/src/lib/statPicks.test.ts::withPickedXGroup`
* histogram + cumulative-percent page: layer 1 row-less 219 of `H`.`T`, layer 2 on `H@N`, same frame / X range, a column of `H@N` equals `T`'s bin counts over `H@N`'s even X (left- or right-closed) → layer 1 re-bound to that counts column as `column` → `SOP_meas` Graph37 / 38 / 42 / 45 (`HISTPROB`; sheet columns = centre, counts, cumulative, cumulative %; counts recomputed from the raw column) → `T::test_histogram_layer_rebinds_to_origins_bin_counts`, `T::test_right_closed_bins_are_origins_too`, `T::test_counts_that_are_not_the_columns_bins_leave_the_page_alone`, `T::test_pairing_needs_the_same_frame_and_the_histograms_own_book`, `T::test_realdata_histogram_cumulative_pages_draw_origins_bins`
* left out (`plot_type_not_drawn`), each formerly drawn as lines (92 public curves):
  * pie / doughnut 225 (`soil deep` Graph3, SOILDEEP1; `RSOS_*_micstruc` *_CIR) → previews → `T::test_kinds_without_a_renderer_are_left_out_not_drawn_as_lines`, `T::test_realdata_grouped_stacked_and_pie` (soil deep Graph3 only; RSOS pages UNGUARDED by realdata)
  * 100 % stacked column 213 on `StackColP` (`fig_6_a` Graph2 / 3) → previews 0..100 % → `T::test_stacked_columns_need_the_stackcolumn_template`, `T::test_realdata_grouped_stacked_and_pie`
  * 213 on a user template (`Graph_Template` / `Graphs` 32New, 32New_wMean, CQITCRLayerMod L4; `Fig_3` Graph2 L2) → previews (stacked / 100 % columns) → `T::test_stacked_columns_need_the_stackcolumn_template` (corpus pages UNGUARDED by realdata)
  * several 215, or 215 beside 203 (`LSA_fig6` Graph6 / 8, `TEA_ExcelGraphs` Graph9, `SOP_meas` Graph14 L6, `Graph_Template` / `Graphs` Graph1) → previews (grouped horizontal; `Graph_Template` Graph1 upright) → `T::test_single_horizontal_bar_kept_only_alone_on_a_one_layer_bar_page`, `T::test_realdata_stacked_area_and_horizontal_bar_pages` (LSA only; others UNGUARDED by realdata)
  * 215 on a multi-layer page (`SOP_meas` Graph65 L5) → preview (sideways panel) → `T::test_single_horizontal_bar_kept_only_alone_on_a_one_layer_bar_page` (page UNGUARDED by realdata)
  * floating column 207 (`Degree of impact` Graph26, 511, 512) → previews → `T::test_kinds_without_a_renderer_are_left_out_not_drawn_as_lines` (pages UNGUARDED by realdata)
  * vector 218 (`30流场` Graph6, `50流场` Graph10 L2) → previews (arrow field) → `T::test_kinds_without_a_renderer_are_left_out_not_drawn_as_lines` (pages UNGUARDED by realdata)
