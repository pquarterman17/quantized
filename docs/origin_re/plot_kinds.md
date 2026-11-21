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
| pie / doughnut (225) on a multi-layer page, or a bar-of-pie | `soil deep` SOILDEEP1 (pie + two violin panels); `TEA_ExcelGraphs` Graph1 / 12 (`BarofPie`). Lane P3 draws the one-layer pies and doughnuts (`soil deep` Graph3, `RSOS_*` *_CIR) | the Pie window draws one-layer pages; a bar-of-pie's bar is not decoded |
| stack on a multi-layer page (213; Lane P2 decoded the 100 % flag: plain on `Graph_Template` / `Graphs` L4, 100 % on `Fig_3`) | `Graph_Template` / `Graphs` 32New, 32New_wMean, CQITCRLayerMod (layer 4); `Fig_3` Graph2 layer 2 | the Stat Stage draws one-layer pages only |
| a plot GROUP in an exchanged-axes layer, or a turned panel of a multi-layer page (Lane P3 draws `LSA_fig6` Graph6 / 8: standalone plots, overlapping) | `TEA_ExcelGraphs` Graph9 / 13, `SOP_meas` Graph14 L6, Graph65 L5, Graph40 L5 / L9, Graph55 L5 (Lane P2) | grouped sideways bars and turned panels are not drawn (gap / overlap not decoded) |
| floating column (207), three or more plots | `Degree of impact` Graph26 | Lane V draws the two-plot pairs (below); Graph26's preview has group gaps its X does not carry and no width column: left out |

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

## Lane P3 (2026-11-21): pies and doughnuts, overlapping sideways bars, the rest decoded

Both corpora scanned (public 351 + owner 104; `generated/` and the synthetic
sets excluded). Every fact below is checked against Origin's saved previews
(`tools/visual`, private port 8937, stage + whole-window shots).

### Pie and doughnut (225): DRAWN (`opju_pie`, the Pie window)

**Binding.** The curve record's `(X, Y)`: Y holds the wedge values, X the
labels. `soil deep` Graph3 (`soildeep`, X = A text, Y = B = 69 / 45 / 18):
the preview prints 52.3 / 34.1 / 13.6 % on the wedges (B over its sum) and
its legend reads A's three labels. A layer of several 225 plots is a
multi-ring doughnut: `RSOS_SC_micstruc` RSOS_SC_CIR (`Matlab` A vs B..K, 10
rings) and `RSOS_TC_micstruc` RSOS_TC_CIR (9). The wedge borders measured on
the RSOS_SC_CIR preview, ring by ring every 0.5 degrees, equal the
cumulative shares of B..K within 1-2 degrees with B innermost and K
outermost, clockwise from 12 o'clock (ring 1: borders at 74 / 100 / 191 /
227 / 287 degrees; data 73.8 / 99.9 / 191.0 / 225.7 / 285.8).

**Record** (34 plot-225 records: 13 `soil deep` pies on `Pie2D` /
`MergeGrap` pages, 19 RSOS rings on `Doughnut` pages, 2 `TEA_ExcelGraphs`
bar-of-pie plots on `BarofPie` pages):

| byte | pies | rings | bar-of-pie | read as |
|---|---|---|---|---|
| 206 | `00` | `01` | `00` | doughnut flag |
| 165 | `32` (50) | `28` (40) | `00` | hole % (read only with the flag): preview hole 25 / 64 px = 0.39 on both axes |
| 27, 114 | `00` | `00` | `04` | non-zero: bar-of-pie, left out |
| 150 | `5a` (90) | `5a` | `5a` | first wedge at 12 o'clock (every preview); another value is left out |

The page template is a second, independent field: a `Doughnut` page whose
record says pie, a `Pie*` page whose record says doughnut, or a `BarofPie`
page, is left out; a `MergeGrap` page leaves it to the record. Every corpus
record agrees with its template (negative controls: 13 pies with the flag
clear, 2 bar-of-pie with 27 / 114 set).

**Drawn** when the page has one layer, every curve is a read pie on one
sheet against its own X, all with one hole, and several plots only as
rings: the figure gets `pie: {book, x, y: [...], hole}` and
`pie_marks_not_decoded`. The apply opens the **Pie chart** workshop
(`components/workshops/pie/`, lazy, inside the aux-figure chunk); the XY
stage draws none of the curves. Its preview is the server's matplotlib
render (`calc/figure_pie.py`, `POST /api/export/pie-figure`) of exactly the
request Export sends, so screen and file agree. Wedge colours are the
theme's `--series-N` tokens resolved to hex; labels go to the legend and a
one-ring pie prints each share in percent. Origin's colours, label
placement, radius and explosion are not decoded.

Drawn: `soil deep` Graph3, RSOS_SC_CIR, RSOS_TC_CIR (+20 curves). Checked
against the previews: Graph3's 52.3 / 34.1 / 13.6 % wedges in Origin's order
and direction; RSOS rings in plot order on a 40 % hole. Left out:
SOILDEEP1 (pie panel of a 3-layer page; its violin panels are left out too),
`TEA_ExcelGraphs` Graph1 / 12 (bar-of-pie). The other 10 `soil deep` pie
pages stay `curve_sheet_unresolved` (their `@2` sheets do not resolve; not
this lane).

### Horizontal bars: standalone plots overlap (DRAWN), a group does not decide

Record byte 6's `0x30` bits are the plot-group role `curve_style_color`
reads on lines (`0x2_` head, `0x1_` member, `0x0_` standalone). On bar
plots the low bits differ (`0x20 0x21 0x10 0x11 0x00 0x01 0x09`), the
`0x30` bits do not. Corpus (all 203 / 213 / 214 / 215 records): every layer
Origin draws side by side (the grouped pages of Lane P) is a head plus
members; the standalone multi-203 layers (`optimal_MOI` x6, `sm_X5` x3,
`fig03_bar_sem_tips`) are the several-X layers that never reached the
grouped chart. The grouped chart now also REQUIRES one plot group (no
corpus change: the rule held already).

`LSA_fig6` Graph6 / 8 are two STANDALONE plots (a 203 and a 215) on one
sheet X in an exchanged-axes layer. Their previews draw both bars at the
same position with the same thickness: translucent cyan over yellow reads
green where both run (row 37: C = 0.512, E = 0.499 is green to 0.499 with a
yellow tip; row 2: C = -0.146, E = -0.045 is green to -0.045, yellow to
-0.146). Both are now drawn sideways (`bar`), overlapping, with their error-bar
plots attached as on the one-plot pages Graph1-5/7/9 (whose bars were
already drawn this way).
Gap / overlap of a GROUP is not decoded: `TEA_ExcelGraphs` Graph9 is a head
plus a member yet overlaps in its preview (tornado), Graph13 is a group of
three: both stay left out, as do the grouped turned panels of `SOP_meas`
(Graph14 L6 215 x9, Graph40 L5 / L9 and Graph55 L5 203 x4, all head +
members on multi-layer pages). No record byte separated the overlapping
group from the side-by-side ones (byte 122: `16` / `10` / `2c` / `24`,
not a percentage).

### Floating column (207): binding decoded, LEFT OUT

The token's modifier block (`SYSTEM ... 06 <n>`, the bubble block of
`opju_plot_kinds`) carries extra datasets: `Degree of impact` Graph511 /
512 name designation 39 = the sheet's width column (Book511 E = 0.4: the
preview's block 1 spans x 0.8..1.2), Graph26's first two plots name 32 = its
first Y (F). The bars span CONSECUTIVE Y columns in plot order: Graph26
(F, G, H) draws F..G and G..H (preview labels 9.3 / 3.6 at the ends of row
1, the colour change at G = 5.7; row 3 runs from H = -0.1 to F = 6.9);
Graph511 (F, G) one bar F..G per row (0.9..1.1 at x = 1). Not drawn: the
XY bar renderer draws bars from zero only (no per-point base, and it is
eager code with 0.3 kB of bundle headroom), Graph26's preview leaves a slot
between its three region groups that its X (row index 1..12) does not
carry, and Graph511 / 512's per-row widths have no renderer. Kept as
`plot_type_not_drawn`.

### Vector XYXY (218): end points decoded, LEFT OUT

The token's modifiers name the end points: 13 = `Book1_C` (X end), 14 =
`Book1_D` (Y end) on both vector plots (`30流场` Graph6 L2, `50流场` Graph10
L2), and no other plot of either corpus carries 13 or 14 (negative control
over every modifier block: 9 / 12 bubbles, 18 / 19 colour maps, 32 / 37 /
38 / 39 / 40 / 62 on other kinds). So an arrow runs from (A, B) to (C, D):
in `Book1`, D equals B on every row and A is the section position (-40, 0,
20, ... 190), so every arrow is horizontal and ends on the profile line
(C vs D) the same layer draws, which is what the preview shows. Not drawn:
quantized has no XYXY arrow renderer (the vector-field workshop grids X, Y,
U, V and cannot take segments), and the page's layer 1 (the colour field
under the arrows) is not imported. Kept as `plot_type_not_drawn`.

### Stacks on multi-layer pages: LEFT OUT (why)

`Graph_Template` / `Graphs` 32New, 32New_wMean, CQITCRLayerMod layer 4
(plain 213 stacks of 3-4 series, fractions summing to 1; the 32New preview
shows the dense stack that reads as a stacked area) and `Fig_3` Graph2
layer 2 (16 series, 100 %). A multi-layer page applies through the
spatial multi-panel path, which builds one uPlot XY panel per layer; only
the Stat Stage stacks, and it draws one canvas per page. In an XY panel a
stack needs bars with a base (series k from the sum of the series before
it): the same missing machinery as the floating column. Drawing the
cumulative tops from zero instead would overlay translucent bars whose
colours mix, which is not Origin's stack. They stay left out.

### Owner checks (COM) left open (Lane P3)

Pie: `layer.plot1` pie properties on RSOS_SC_CIR (doughnut on, hole 40 %)
and on `soil deep` Graph3 (doughnut off), and the start angle / direction.
Group overlap: `layer.plotN` group gap / overlap on `TEA_ExcelGraphs`
Graph9 (expect overlap 100) and Graph13. Vector: `DataPlot::GetModifiers`
on `30流场` Graph6 L2 (expect C as X end, D as Y end). Floating column:
the same on `Degree of impact` Graph511 (expect E as the width) and Graph26.

### Visual check and corpus delta (Lane P3)

Shots (`origin_preview_shots.mjs --full`) of `soil deep`, both RSOS
projects and `LSA_fig6`: Graph3 opens the Pie chart window with Origin's
three wedges; RSOS_SC_CIR / RSOS_TC_CIR show 10 / 9 rings on a 40 % hole,
first plot innermost; `LSA_fig6` Graph6 / 8 draw two overlapping sideways
series, the long row-37 bar reaching 0.51. Moke, PNR and RockingCurve are
unchanged (no owner-corpus change in the regress check).

`tools/origin_regress.py check --base origin/main --jobs 4` (bb0de532, after
#791; public + owner corpus): 3,782 figures either way; curves 9,108 ->
9,132 (+20 pie / doughnut curves, +4 `LSA_fig6` Graph6 / 8); 61 changes in 4
public projects, all explained by
[`regress_allow/laneP3-plot-kinds.json`](regress_allow/laneP3-plot-kinds.json)
(the LSA error-bar plots that now attach to their bars leave the omission
list). Owner corpus: no change.

## Ledger

Indexed in [DECODE_LEDGER.md](DECODE_LEDGER.md): F-100 to F-107, B-24, R-28; Lane P2: F-108, F-109, B-26 to B-28, R-29, R-30; Lane P3: F-110 to F-114, B-31, B-32, R-33.

## Lane V (2026-11-21): floating columns and vectors drawn as shapes

Both kinds are rectangles / arrows at data coordinates, so the importer
delivers `figure.data_marks` (`opju_float_vector`) and the lazy apply turns
them into plot shapes (`lib/originDataMarks`): the screen shape draw and the
matplotlib export (`figure_shapes`) already exist, nothing ships eagerly.
The plots leave `curves`; a mark never takes a series slot.

### Floating column (207): Graph511 / Graph512 drawn

Record byte 6 `& 0x30` reads `0x20` (value 41) on the first plot and `0x10`
(17) on the next: a plot group, head then member. Both name the same width
column as modifier 39. One rectangle per finite row, centred on X, FULL
width = the width column, from the head's Y to the member's Y. Graph511
(`Book511`: x error * 2 is the width, min y / max y the bottom / top) and
Graph512 (X = G, width H, bottom I, top J: four different columns of a
permuted sheet) were measured on Origin's saved previews: Graph511 blocks are
20 / 30 / 41 px wide for widths 0.4 / 0.6 / 0.8 (50.7 px per X unit, centres
at X = 1 / 2 / 3, rows 3 and 4 overlap as in the preview), Graph512 25 / 25 /
40 px for 0.5 / 0.5 / 0.8 and 11 / 14 px tall for 0.4 / 0.5. Not proven and
left out: Graph26 (three floating plots, no width modifier; its preview has
gaps between region groups that its X 1..12 does not carry), a floating plot
with no width column, an exchanged-axes layer or one whose layer record
does not authenticate (orientation unknown; all 4 proven pages read
`axes_exchanged` = False), a multi-panel page. The fill
colour (green in the preview; the record's colour is the black outline) is not
decoded: the shapes use the plot's default ink at 35 % opacity.

### Vector XYXY (218): 30流场 Graph6, 50流场 Graph10 drawn

Modifiers 13 / 14 on columns of the plot's own sheet; arrow from (X, Y) to
(X end, Y end). On both projects every arrow is horizontal (end Y = start Y)
and ends on the profile the layer's other plot draws, as the preview shows.
The colour-field layer 1 of those pages holds no curves and is not imported,
so the page counts as one plotted layer; any other layer with curves makes it
a panel page, which stays left out (shapes belong to the page). Arrowheads
use the shape's own head size (Origin's is not decoded); colour and line
width come from the record (width floor 0.5).

### Evidence and what is still open

Previews only: no controlled specimen or COM read of these four plots exists
in the local corpora, so the rules are deliberately narrow (the exact
modifier shapes, exactly two floating plots, exactly one vector plot) and
everything else is left out. Owner COM checks: `DataPlot::GetModifiers` and
the plot group of `Degree of impact` Graph511 / 512 / 26 (expect 39 = width,
a head and a member) and of `30流场` Graph6 L2 (expect 13 / 14 = C / D); the
floating column's fill colour and the arrowhead size for the Details dialog.

Regress (`origin_regress.py check --base origin/main`, public + owner): 3,782
figures, 9,113 curves either way; 13 changes in 3 public projects, all in
[`regress_allow/laneV-float-vector.json`](regress_allow/laneV-float-vector.json):
the 6 plots drawn as marks leave the left-out list and the fidelity notes gain
`data_marks_not_decoded`. Owner corpus: no change.

## Text X on a later sheet (Lane OD, F-117)

A curve on a `Book@N` sheet whose X is that sheet's Text column (designated X,
`x_column_name` empty) was omitted `x_not_imported` (81 public curves). The
text column IS imported (`origin_text_columns`), so the omission was the
backend's own check, not a missing decode. Opening it for every kind was tried
on 2026-11-21 and measured against Origin's saved previews: 51 curves gained,
of which only the 5 `soil deep` pies were right (wedge shares equal the
preview's to the printed digit). The other 46 drew grouped columns (`Figure4`
Graph3 / 6 / 7 / 8 / 9 / 10) as lines, and `RSOS_SC_BAR` as a grouped-bar Stat
Stage with a pie window over it. `opju_curve_sheets._unbound_reason` therefore
admits a text X only for `plotType` `pie`; the rest stay `x_not_imported` until
grouped columns over text categories draw as columns. Guards:
`tests/test_io_origin_text_x_pie.py`.
