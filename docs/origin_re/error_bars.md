# Error-bar plots: which curve they decorate (2026-11-20)

An Origin error-bar plot is a DataPlot of its own, Origin plot type 231
(Y error) or 233 (X error). quantized does not draw it as a curve
(`opju_plot_gates`, PR #704). Before this change the bars were drawn only
where the error column's worksheet designation paired it with a Y. Most
designations do not decode, or the error column is designated Y, so most
bars were lost: 1,777 public figures (1,803 once #775 recovered more graph
pages) and 24 owner figures carried the fidelity code `error_bar_plots`.

`io/origin_project/opju_error_bars.py` now reads the binding from the plot
record itself. It sets `yErr` (and, since lane E2, the asymmetric halves,
X bars and the band flag) on the curve the bars decorate, where that is
proven. Everything else stays left out as `error_bar_plot`. The `.opj` anchor
record is the same record, so `.opj` uses the same rule (`opj_curves`).

## The record

All offsets are in the 519-byte plot record (`curve_style_color`; the
`.opju` curve token is its sparse form).

| offset | data curve | error-bar plot |
|---|---|---|
| 4-5 | plotted (Y) column id | the error column's id |
| 23 | style flags | **direction**: bit `0x01` plus, `0x02` minus (`3` = both); bit `0x10` = an X-error plot |
| 28 | `0` / `1` | **fill**: `2` = a filled error band, `0` = bars (see below) |
| 35-36 | X column id | **the id of the column the bars decorate** |
| 37-38 | `21 61` (`21 21` hidden) | `30 61` (`10 60` on a non-Text & Numeric column; `30 21` hidden) |
| 76 | plot type (`0xc8` line ...) | `0xe7` (231) or `0xe9` (233) |

An error plot's "X" is the column of the curve its bars sit on. Plot order
is not the binding. The error plot can come before the curve, after it, or
several plots away from it.

## Evidence

**Rendered oracle and COM plot lists (owner corpus).**

* `Fixed Lambdas SI.opju` Graph1: COM plot list `I` (SA), `K` (Theory SA),
  `J` (dSA), then three more theory lines. `J`'s offset 35 names `I`.
  Origin's exported graph (`_exports/.../NbAl.png`) draws the bars on the
  teal SA scatter. The `K` line, which is the plot before `J`, has none. A
  "curve before it" rule would put them on `K`.
* `UnpolPlots.opju` NdNiO3NR: COM plot list `H` (dR Fresnel) FIRST, then `G`
  and `I`. `H` names `G`, and Origin's export draws the bars on `G`.
* `MnN_Diffusion_PNR.opj` Graph10 (`.opj`): `J` (dSA, designated **Y**)
  names `I` (SA). Origin's export draws Y and X bars on the SA triangles.
  quantized drew `J` as a phantom "dSA" line (`_exports/.../quantized/Graph10.png`).
  Now it draws Y bars from `J` and X bars from `dQ` on SA, with no `dSA`
  line.

**Distribution.** 3,663 error-bar records reconstruct across the two
corpora (`.opju`). 3,654 have a decoded column.

* Every X field names a column of the error column's own book.
* 3,214 name exactly one data curve of the same layer. None names two.
* The other 440 name a column the layer does not plot: 436 in
  PerceivedRisk, 4 in `calibration_for_fig4`. They stay left out.

**Direction.** The 3,654 decoded records split as follows:

* Offset 23 = `3` (both ways) on 1,491 records.
* `1` + `2` on 1,075 curves that have two error plots: the plus half and the
  minus half.
* `0x11` / `0x12` / `0x13` with byte 76 `0xe9` on all 8 `0xe9` records.
* `0x11` / `0x12` with byte 76 `0xe7` on 12 records. The 2026-11-15 COM
  sweep found exactly 12 `0xe7` tokens that Origin reads as 233.

Which half is which is proven by two independent oracles in
`Graph_Template.opju` (also in `Graphs.opju`):

* The author's own column names. `2` is on `Lower_Bound`, `LB_Layer` and
  `XerrMinus10/100/390`. `1` is on `Upper_Bound`, `UB_Layer` and
  `XerrPlus*`. That is 14 halves, 0 exceptions.
* Origin's saved page preview of `32New`. CQI (`T`) has bars from
  `U` = Lower_Bound (`2`) and `V` = Upper_Bound (`1`). The bar extents
  measured off the preview match `T - U .. T + V` at every distinguishing
  point (x = -1: 5..9, x = 3: 6..11, x = 11: 8..13). They do not match the
  swapped reading (7..11, 5..10, 7..12).

The `XerrMinus/Plus` columns of `43Lollipop` are also the 12 `0xe7`
X-error records. So bit `0x10`, not byte 76, decides the axis.

**Negative controls.**

* The 6 hidden error plots (`30 21`; 5 in public `Fig3_e` Graph1) never link.
  Origin's preview draws no bars there (`curve_visibility.md`). The same
  file's Graph2 plots the same columns of sheet 2 with SHOWN error plots
  (`30 61`). Its preview draws an error band on every curve, and all 5
  curves get their `yErr`.
* The 4 `10 40` records (BET) never link, nor does any other flag value
  at offset 23.
* No data curve's record links: it has no `0xe7` / `0xe9` byte.
* `Hc2 data.opju` has 0 error-bar records. Its Graph40 magenta bars stay
  undrawn, which is right (`hc2_open_gaps.md`).

## The rest of the bars (lane E2, 2026-11-20)

#778 attached one symmetric Y column per curve. This round attaches the
rest where the evidence proves what Origin draws, and decodes the band.

### Asymmetric halves

A curve with a plus (`1`) and a minus (`2`) half whose columns differ gets
`yErrPlus` / `yErrMinus` (`xErrPlus` / `xErrMinus` for X). The direction
bits now have a third oracle besides `Graph_Template`'s names and `32New`'s
preview: public `PerceivedRiskandPrediction` Graph1 plots `C` with `B`
(offset 23 = `2`) and `D` (`1`). Origin's saved preview fills
`C - B .. C + D`: at x = 0..5, C = 1, B = 0, D = 1 gives the band 1..2
(the line sits on the band's lower edge); at x = 12, C = 4, B = 2, D = 1
gives 2..5. The swapped reading (0..1, 3..6) does not match.

### X-error plots

One both-ways X plot gives `xErr`, a pair `xErrPlus` / `xErrMinus`.
`Graph_Template` `43Lollipop` draws its stems this way: each curve's X
halves span exactly `min(0, x) .. max(0, x)` (minus = x, plus = 0 for a
positive x; the reverse for x = -0.5). Origin's preview draws those stems
from the zero line to each point; quantized now does too. MnN Graph6-12
(owner, `.opj`) get `xErr` from their dQ plot; Origin's exported Graph10
draws those horizontal bars.

### Two both-ways plots on one curve

All 420 public cases (PerceivedRisk, both copies: `N` and `P` on `O`)
plot two columns that hold the same values on every row. Whichever plot
Origin draws, the bars are the same, so the curve gets `yErr` from the
first. Graph29AA's preview shows that narrow band on `O`. Two both-ways
plots with different values stay left out (0 in either corpus).

### Bands: record offset 28

Offset 28 of an error-bar record is `2` when Origin fills the error as a
band and `0` when it draws bars. The curve gets `errBand: true`, which the
frontend maps to `SeriesStyle.errorBar.band`; the canvas and the export
already draw that band (`uplotErrorBand`, `figure_errorbars`).

* Distribution: error-bar records read only `0` (762) or `2` (3,059) at
  offset 28; data curves read only `0` or `1`. Offset 30 (`0x10` on
  3,481 records) does not separate them: calibration's whisker plots carry
  it too.
* Positive controls: every saved preview of a `2` plot draws a band —
  PerceivedRisk (Graph1, 29, 29AA, 30, 31), `NS1del_vs_WT` Graph1-2,
  `Fig2.a&b` Graph3 and 10, `Fig3_e` Graph2, `成功率` Graph1, `稳定性`
  Graph12, `calibration_for_fig4` Graph1-4.
* Negative controls: every `0` plot draws bars — `calibration_for_fig4`
  Graph2 draws bars on exactly its two `0` plots (Book2 / Book3
  experimental data) and bands on its four `2` plots in the same graph;
  also LossPlot, `Extended Data Fig. 6`, `Figure_1`, `Analiza` Graph6,
  `optimal_MOI` Graph5, `v2_review` Graph1, `hyperspectral` Graph5 (offset
  30 = `8`), and the owner's Fixed Lambdas, UnpolPlots and MnN exports.
* Fail closed: a curve whose halves disagree on the flag, and any X plot
  carrying it (0 observed), stay left out.

Cap width, colour and band transparency are still not decoded.

### Error plots that name no curve: Origin draws nothing

440 public plots (PerceivedRisk 436, `calibration_for_fig4` 4) name a
column no data curve of the layer plots: either a column the layer does
not plot at all, or another error plot's column (PerceivedRisk Graph29
layer 1: `F` names the error column `D`; `H` names `G`, a curve of layer
2). They are now left out as `error_bar_no_curve`, which is not a loss:

* `calibration_for_fig4` Graph3 holds the error plots of Book6-8 but not
  their curves; its preview has no bars there. Graph2 plots those curves,
  and the same plots draw their bands.
* PerceivedRisk Graph29-31 previews show only the layer-1 band (`B`/`D`)
  and the layer-2 one: no whiskers from `F` or `H`, though both columns
  hold values up to 3.7.

`.opju` passes every plot id of the layer (decoded or not), so a plot the
decoder skipped is never taken for an absent one.

## What is drawn

`attach_error_bars` runs once the books are imported. Per curve and axis:

| error plots of the curve | curve fields |
|---|---|
| one both-ways plot | `yErr` / `xErr` |
| plus + minus, same values | `yErr` / `xErr` (either column) |
| plus + minus, different values | `yErrPlus` + `yErrMinus` / `xErrPlus` + `xErrMinus` |
| two both-ways, same values | `yErr` / `xErr` (the first) |
| any of the above with offset 28 = `2` on every plot (Y only) | `errBand: true` |

The error columns must be value columns of the curve's own imported book
and sheet.

Frontend:

* `yErr` rides the legacy `errKeys` (`figureCurveErrKeys`), as before.
* The others become canonical error bindings
  (`lib/originCurveErrorRoles.ts`). The apply writes them into the focused
  window's document errors (`figureDocumentErrors`), which both the canvas
  (`errorSpans`) and the export (`error_spans`) read. A later figure on the
  same book clears them.
* Cross-book overlays carry the columns as hidden `"Y"` columns plus
  `origin_overlay_error_roles`; spatial multi-panel pages carry them per
  panel (`SpatialPanel.errors`), drawn by `spatialPanelFetch` and exported
  by `spatialPageExport`. The page export now also carries each panel's
  symmetric `errKeys` bars, which the canvas drew but the export dropped.
* Graph Builder is unchanged: it builds its own error wells from the
  dataset's roles.

## Still left out (`error_bar_plot`, fidelity `error_bar_plots`)

Measured on main `97a8be72` + this change.

| case | public | owner |
|---|---|---|
| curve's book not imported (the whole curve is lost: `DO.opj`, `稳定性`) | 25 | 0 |
| decorated curve itself left out (`plot_row_range` 6, `x_not_a_column` 1) | 7 | 0 |
| unread pair `10 40` (BET) | 4 | 0 |
| error column not imported (`Figure_9` / `Figure_10` `G`) | 2 | 0 |
| half a pair (one minus X plot, `Degree of impact` Graph512) | 1 | 0 |
| **left out** | **39 plots, 14 figures** (was 1,785, 882) | **0** (was 12, 12) |
| `error_bar_no_curve` (Origin draws nothing; not a loss) | 440 | 0 |

## COM checks for the owner

On a machine with Origin 2026b:

1. **The asymmetric halves on a controlled specimen.** In a new book, set
   A = X, B = Y, C = +err, D = -err with different values. Plot B with
   asymmetric Y error bars from C and D (Plot Setup: yEr+ = C, yEr- = D).
   Save it as `asym_probe.opju`.
   * Expected: C's plot record has offset 23 = `1` and D's has `2`, both
     with offset 35 = B's id.
   * Then read the direction in LabTalk with `layer.plotN.errbar.direction`
     (or Plot Details > Error Bar > Direction) for each plot. This closes
     the proof the long names and the two previews already give.
2. **The band flag.** In the same specimen turn on Plot Details > Error
   Bar > "Fill Area" (error band) for C, save as `band_probe.opju`.
   Expected: only offset 28 changes, `0` -> `2`.
3. **An error plot naming no curve.** In `calibration_for_fig4.opju`,
   `win -a Graph3; layer -c;` then list the plots: Book6-8's error plots
   should be present with no visible bars (the preview says so).

## Ledger

Indexed in [DECODE_LEDGER.md](DECODE_LEDGER.md): F-064 to F-069, B-18 to B-21, R-09.
