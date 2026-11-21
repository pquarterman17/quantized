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
| horizontal bar: the one bar / column plot of a one-layer page whose layer has its X/Y axes exchanged (Lane P2; Lane P used the `Bar` template) | `bar` (turned plot, `lib/uplotOrient`) | 7 (`LSA_fig6` Graph1-5/7/9) | horizontal. `SOP_meas` Graph67 (upright layer) is now an upright column, as its preview shows (see Lane P2 below) |
| stacked column (213), one series, not on a `StackColP` page | a stack of one: `column` (a 100 % stack of one is left out) | 1 (`SOP_meas` Graph20) | upright columns |
| several column series (203) on one X | `bar_layout: grouped`: Stat Stage bar chart grouped by X | 8 (`fig_6_a` G1, `fig_7_a`, `5_sidechain` x2, `Supplemetary_Fig_9`, `Figure_1`, `Figure_2`, `TEA_ExcelGraphs` Graph2) | bars side by side per X, same order and heights |
| several stacked columns (213) on a `StackColumn` page | `bar_layout: stacked` | 2 (Etna `origin.opju` Graph17 / 19) | same stack order (first plot at the bottom), heights |
| histogram + cumulative percent | layer 1 re-bound to Origin's bin sheet (below) | 4 (`SOP_meas` Graph37 / 38 / 42 / 45) | bars 41 / 8 / 2 (Graph37), cumulative line on the right axis |

A grouped / stacked layer is drawn only when every curve's X is the sheet's
own X column (a curve against another column goes through the frontend's
own-X overlay, never the stage: `SOP_meas` Graph75 drew four overlapping bars
that way and is left as on `main`), when that X (from the imported book)
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
| stack on a multi-layer page (213; Lane P2 decoded the 100 % flag: plain on `Graph_Template` / `Graphs` L4, 100 % on `Fig_3`) | `Graph_Template` / `Graphs` 32New, 32New_wMean, CQITCRLayerMod (layer 4); `Fig_3` Graph2 layer 2 | the Stat Stage draws one-layer pages only |
| several plots in an exchanged-axes layer, or a turned panel of a multi-layer page | `LSA_fig6` Graph6 / 8, `TEA_ExcelGraphs` Graph9, `SOP_meas` Graph14 L6, Graph65 L5, Graph40 L5 / L9, Graph55 L5 (Lane P2) | grouped sideways bars and turned panels are not drawn (gap / overlap not decoded) |
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

Lane P's three checks are answered from the layer record (Lane P2 below):
Graph67 and `Graph_Template` Graph1 are upright layers (exchanged-axes flag
clear), and the 100 % flag lives in the layer record (byte 187). A COM read
of those layer properties would still confirm the decode (listed below).

## Corpus delta (sweep2, `main` 97a8be72 -> this change)

Public (351 files): curves 7,841 -> 7,753, figures with curves 2,966 -> 2,949,
books and actionable figures unchanged. -92 curves left out as above, +4
histogram layers drawn; 21 + 8 + 1 curves re-kinded (area, horizontal bar,
column) and 10 layers moved to the Stat Stage bar chart. Owner corpus (104
files): no change (every owner curve is 200-202).

## Lane P2 (2026-11-20): the layer's own flags, Origin's Y range, 100 % stacks

Lane P's open issues, settled from the layer record (`opju_layer_record.
layer_flags`) instead of the plot type and template. Both corpora (public
351 + owner 104, `generated/` and the synthetic sets excluded) were scanned:
every graph-layer record that authenticates (`layer_record`) and continues as
`00 10` at bytes 100-101 (3,595 of 3,795 expandable records).

### Exchanged X/Y axes: byte 104, bit `0x40`

Origin's horizontal bar chart is a LAYER whose X and Y axes are exchanged.
Bit `0x40` of byte 104 is set on exactly 21 graph layers, and every one is
drawn sideways in Origin's saved preview, whatever its plot type:

| layers with the bit | plot types | preview |
|---|---|---|
| `LSA_fig6` Graph1-9 | 215 (Graph6 / 8: 215 + 203) | horizontal bars |
| `TEA_ExcelGraphs` Graph9 / 13 / 19 | 215 | horizontal (Graph9 a tornado of two series) |
| `TEA_ExcelGraphs` Graph15 / 16 | none decoded | empty frame, value axis horizontal |
| `SOP_meas` Graph14 L6, Graph65 L5 | 215 | sideways SHAP panel |
| `SOP_meas` Graph40 L5 / L9, Graph55 L5 | 203 | sideways bar panel |
| `Degree of impact` Graph278 L1 / L2 | 215 / 203 | population pyramid |

Negative controls: every other 215 layer has the bit clear and is UPRIGHT in
its preview: `SOP_meas` Graph67 (a lone 215 on the `Bar` template: five
rising bars, "Mean |SHAP value|") and `Graph_Template` / `Graphs` Graph1
layer 1 (two 215 plots, upright columns). No line or scatter curve sits in a
layer with the bit set. Byte 104 otherwise reads `00 08 28 80 88 a8` (bits
`0x08 0x20 0x80`, not decoded); records with another continuation (sparklines,
`FitLine` report graphs) are not read (fail closed: no flag).

So the PLOT TYPE does not set the orientation, the LAYER does. Rules
(`opju_bar_kinds._resolve`):

* flag set: the layer's one bar or column plot of a one-layer page is drawn
  sideways (`bar`). Anything else in a turned layer is left out: grouped /
  stacked sideways bars are not drawn, and a curve drawn upright in a turned
  layer would sit where Origin's does not.
* flag clear: a 215 plot is Origin's column (`column`) and follows the column
  rules (one series: bars; several on one sheet X: the grouped Stat Stage;
  on a multi-layer page: by line style, as every 203 there).
* no flag (record not read): a 215 plot is left out with any column beside
  it (orientation unknown); a lone 203 keeps `main`'s upright reading.

Item 1 (`SOP_meas` Graph67) is therefore FIXED: drawn as one upright column
series, as its preview shows. It was not a stale preview: its layer is
upright, while Graph65 panel e (same V / W data) is a turned layer. The
Bar-template rule of Lane P is gone; the `LSA_fig6` one-plot pages still draw
sideways (flag set), and `TEA_ExcelGraphs` Graph19 would too, but its sheet
`Book1@14` is not imported (`x_not_imported`, unchanged).

### 100 % stack: byte 187, bit `0x02`

Set on exactly 3 graph layers of both corpora, all 213 stacked-column layers
whose previews run 0..100 %: `fig_6_a` Graph2 / Graph3 (`StackColP`; raw
monthly counts drawn as shares, so the preview cannot be a plain stack) and
`Fig_3` Graph2 layer 2 (a `MergeGrap` page: the template alone would have
missed it). Clear on every plain stack: Etna `origin.opju` Graph17 / 19 and
`SOP_meas` Graph20 (`StackColu`, sums below 100) and `Graph_Template` /
`Graphs` 32New, 32New_wMean, CQITCRLayerMod layer 4 (user templates; fractions
summing to 1 on a 0..1 axis, not 0..100). Byte 187 otherwise reads `00`, `01`
(all 21 + 3 stacked-area layers, `PARETO*`, the `30流场` / `50流场` layers) or
`10` (pie / doughnut / bar-of-pie layers and some line layers).

The template is therefore NOT sufficient (Fig_3) and not needed: every corpus
213 layer has an authenticated record. It stays only as the fallback when the
record cannot be read (`StackColP` 100 %, `StackColumn` plain, else left out).

Drawn: a one-layer page whose 213 series all sit on one sheet's own even X
gets `bar_layout: "percent"`, the Stat Stage stacked bar chart normalised to
100 % per category (`barMatrix.percentBars`: each series' share of the
category's stacked total, screen and export from the same values). The Stat
Stage layout control gains a "100 %" choice, persisted as
`statPicks.barPercent`. `fig_6_a` Graph2 / 3 are drawn (previously left out).

### Origin's Y range on the Stat Stage bar chart (item 2)

`figureBarState` saves the layer's linear Y range as `statPicks.valueRange`
(not for a log or reversed Y); the bar painter uses it as the value domain
and clips bars at the frame (`statDrawMarks.barDomain`, shared with the click
hit-test), and the export sends it as `y_domain` (`ax.set_ylim` in
`calc.figure_categorical`). `fig_6_a` Graph1 (Y 65..75) and `fig_7_a` keep
their zoom, so the bars no longer look equal. A chart grouped by X (only the
Origin pick groups by X) hides categories with no Y in any series: Etna
Graph19's rows 4-8 (X, no Y) no longer appear as five empty `n=0` slots.

### Item 3: renderers, per kind

| kind | pages | status |
|---|---|---|
| 100 % stacked column | `fig_6_a` Graph2 / 3 | DRAWN (Stat Stage, above) |
| 100 % stack on a multi-layer page | `Fig_3` Graph2 L2 | flag decoded; left out (the Stat Stage draws one-layer pages only) |
| plain stacks on user templates | `Graph_Template` / `Graphs` 32New, 32New_wMean, CQITCRLayerMod L4 | flag decoded (plain); left out: all are panel 4 of 4-layer pages |
| upright 215 | `SOP_meas` Graph67; `Graph_Template` / `Graphs` Graph1 L1 | DRAWN upright (Graph67 one column; Graph1 L1 two series on a 2-layer page, by line style like every multi-layer 203 pair) |
| grouped horizontal bars, bar beside column | `LSA_fig6` Graph6 / 8, `TEA_ExcelGraphs` Graph9, `SOP_meas` Graph14 L6 | orientation proven; NOT drawn: the cluster gap / overlap is not decoded (TEA Graph9's two series share one position in its preview), so a grouped layout would guess |
| 203 in a turned panel | `SOP_meas` Graph40 L5 / L9, Graph55 L5 (`Degree of impact` Graph278 L2 is turned too, but its sheet is not imported: `x_not_imported`, unchanged) | newly LEFT OUT: drawn upright (by line style) on `main`, sideways in Origin |
| pie / doughnut (225) | `soil deep` (12 pie layers: `Pie2D` / `MergeGrap` pages incl. Graph3, SOILDEEP1); `RSOS_*_micstruc` *_CIR; `TEA_ExcelGraphs` Graph1 / 12 (`BarofPie`) | NOT drawn: no renderer exists (Graph Builder and the Stat Stage have no pie; `plotTypes` lists none). A pie needs a new lazy Stat Stage mode plus a matplotlib route; not done in this lane |
| floating column (207) | `Degree of impact` Graph26, 511, 512 | NOT drawn: no renderer; Graph511 / 512 are "error block" columns whose low / high binding is not decoded |
| vector XYXY (218) | `30流场` Graph6 L2, `50流场` Graph10 L2 | data EXISTS (`Book1`, columns A-D, 227 rows; the projects are not graph-only), but the curve record decodes only (A, B); the end-point columns (C, D by Origin's XYXY convention) are not decoded, so the arrows cannot be bound without a guess. The profile line (C vs D) in the same layer is drawn |

Owner checks (COM) left open: `GraphLayer` exchange-axes property on a
`LSA_fig6` page and on `SOP_meas` Graph67 (expect set / clear); the 100 %
stack property on `fig_6_a` Graph2 and `Fig_3` Graph2 L2; a vector plot's
four bound datasets on `30流场` Graph6 L2; the bar group's gap / overlap on
`TEA_ExcelGraphs` Graph9 and `LSA_fig6` Graph6.
### Visual check and corpus delta (Lane P2)

Re-rendered with `tools/visual/origin_preview_shots.mjs` (private port) and
compared with Origin's saved previews: `fig_6_a` Graph1 (Y 65..75, bars now
visibly unequal as in the preview), Graph2 / Graph3 (100 % stacks, month 6
shares 25 / 33 / 42 % as labelled in the preview), `fig_7_a` Graph1 (zoomed Y
0.95..1.04), Etna Graph19 (three stacked categories, no empty slots, Y
0..110), `SOP_meas` Graph67 (five upright rising bars), `LSA_fig6` Graph1
(still sideways). Colours, bar widths and labels remain quantized's
(`bar_marks_not_decoded`).

`tools/origin_regress.py check --base origin/main` (22c75b71, after #787 Lane P
and #788; public + owner corpus): 3,782 figures either way; curves 9,110 ->
9,108; 53 changes in 4 projects, all explained by
`regress_allow/laneP2-renderers.json` (Lane P2's changes only): +6 curves
`fig_6_a` Graph2 / 3 (100 % stacks drawn), +4 `Graph_Template` / `Graphs`
Graph1 L1 (upright 215, back as before Lane P), -12 `SOP_meas` 203 curves in
turned panels; Graph67 re-kinded `bar` -> `column`. Owner corpus: no change.

## Ledger

Indexed in [DECODE_LEDGER.md](DECODE_LEDGER.md): F-100 to F-107, B-24, R-28; Lane P2: F-108, F-109, B-26 to B-28, R-29, R-30.
